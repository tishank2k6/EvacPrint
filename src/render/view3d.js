// Synchronized 3D visualization layer (Three.js).
// Geometry is generated from the same compiled grid the engine uses; every
// frame reads agent positions, states, density and exit status straight from
// the live Simulation instance. Nothing here is pre-recorded.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, T } from '../sim/layout.js';
import { STATE } from '../sim/engine.js';
import { planGeometry, drawUnder } from './floorplan.js';
import { densityRGBA } from './colors.js';
import { icon } from '../ui/icons.js';
import { esc, reducedMotion } from '../ui/dom.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

const COL = {
  bg: 0x0f1113,
  wall: 0xd9d2c5,
  wallGlass: 0xcfe7e2,
  edge: 0x5d5850,
  seat: 0x4a525b,
  seatBack: 0x4d555e,
  stage: 0x343a41,
  obst: 0x6b5a3c,
  door: 0x9c968b,
  adult: 0xe9e2d4,
  slow: 0xe3a03a,
  wheel: 0x8b9be0,
  cong: 0xf06d64,
  wait: 0x8a857c,
  teal: 0x2fb8a6,
  amber: 0xe3a03a,
  red: 0xe0524a,
};

const ROUTE_VS = `attribute float lineDistance; varying float vD; void main(){ vD = lineDistance; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ROUTE_FS = `uniform float uTime; uniform vec3 uColor; uniform float uOpacity; varying float vD;
void main(){ float f = fract((vD - uTime * 1.3) / 1.1); float a = smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.42, 0.58, f)); gl_FragColor = vec4(uColor, a * uOpacity); }`;

export class View3D {
  /**
   * @param host     container element
   * @param source   object exposing { sim, alpha, subscribe(fn) } — the shared controller or a private driver
   */
  constructor(host, source, opts = {}) {
    this.host = host;
    this.src = source;
    this.opts = { controls: true, toolbar: true, hero: false, autoRotate: false, wallHeight: 1.35, glassWalls: false, labels: true, ...opts };
    this.layers = { heat: true, flow: true, bottlenecks: true, chips: true };
    host.classList.add('v3d');

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(this.opts.hero ? 1.5 : 2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    r.setClearColor(COL.bg, 1);
    host.appendChild(r.domElement);
    r.domElement.setAttribute('aria-label', '3D model of the venue with live evacuation');
    r.domElement.setAttribute('role', 'img');

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COL.bg, 55, 120);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
    this.scene.add(new THREE.HemisphereLight(0xe8eef2, 0x15181b, 1.15));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sun.position.set(-14, 26, 12);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fd8cf, 0.35);
    fill.position.set(18, 10, -14);
    this.scene.add(fill);

    // ground + blueprint grid
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x0c0e10 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(120, 120, 0x1f2428, 0x161a1d);
    grid.position.y = -0.01;
    this.scene.add(grid);

    this.world = new THREE.Group();
    this.scene.add(this.world);

    if (this.opts.controls) {
      this.controls = new OrbitControls(this.camera, r.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.maxPolarAngle = Math.PI * 0.47;
      this.controls.minDistance = 8;
      this.controls.maxDistance = 90;
      this.controls.screenSpacePanning = true;
      this.controls.addEventListener('start', () => { this.tween = null; });
    }

    this.labelHost = document.createElement('div');
    this.labelHost.className = 'v3d-labels';
    host.appendChild(this.labelHost);
    if (this.opts.toolbar) this.buildToolbar();
    if (!this.opts.hero) {
      this.hud = document.createElement('div');
      this.hud.className = 'v3d-hud';
      host.appendChild(this.hud);
    }

    this.camTarget = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.time = 0;
    this.lastNow = performance.now();
    this.heatAlpha = this.opts.hero ? 0 : 1;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.unsub = source.subscribe((type) => {
      if (type === 'layout' || type === 'reset') this.ensureWorld();
      if (type === 'frame') this.render();
    });
    this.ensureWorld();
    this.resize();
    this.setView('iso', true);
    this.render();
  }

  // ---------------------------------------------------------------- toolbar
  buildToolbar() {
    const tb = document.createElement('div');
    tb.className = 'v3d-toolbar';
    tb.innerHTML = `
      <button class="btn sm" data-view="iso" title="Isometric view">${icon('iso')}<span>Iso</span></button>
      <button class="btn sm" data-view="top" title="Top view">${icon('top')}<span>Top</span></button>
      <button class="btn sm icon" data-view="reset" title="Reset camera" aria-label="Reset camera">${icon('reset')}</button>
      <button class="btn sm icon" data-zoom="in" title="Zoom in" aria-label="Zoom in">${icon('zoomIn')}</button>
      <button class="btn sm icon" data-zoom="out" title="Zoom out" aria-label="Zoom out">${icon('zoomOut')}</button>
      <button class="btn sm icon" data-rotate title="Auto-rotate" aria-label="Toggle auto-rotate" aria-pressed="false">${icon('rotate')}</button>`;
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.view) this.setView(b.dataset.view === 'reset' ? 'iso' : b.dataset.view);
      if (b.dataset.zoom) this.zoom(b.dataset.zoom === 'in' ? 0.8 : 1.25);
      if (b.hasAttribute('data-rotate')) {
        this.controls.autoRotate = !this.controls.autoRotate;
        this.controls.autoRotateSpeed = 0.6;
        b.setAttribute('aria-pressed', String(this.controls.autoRotate));
      }
    });
    this.host.appendChild(tb);
    const hint = document.createElement('div');
    hint.className = 'v3d-hint';
    hint.textContent = 'Drag to rotate · right-drag or two fingers to pan · scroll to zoom';
    this.host.appendChild(hint);
  }

  setLayer(k, v) { this.layers[k] = v; this.render(); }

  // ---------------------------------------------------------------- camera
  viewPose(kind) {
    // fit the building's bounding sphere to the current frustum, whatever the aspect
    const W = this.size.w, H = this.size.h;
    const R = Math.hypot(W, H) / 2;
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * (this.camera.aspect || 1.6));
    const fit = R / Math.sin(Math.min(vf, hf));
    if (kind === 'top') {
      const vfit = Math.max((H / 2) / Math.tan(vf), (W / 2) / Math.tan(hf)) * 1.08;
      return { pos: new THREE.Vector3(0, vfit, 0.01), target: new THREE.Vector3(0, 0, 0) };
    }
    if (kind === 'hero') return { pos: new THREE.Vector3(0.62, 0.62, 0.8).normalize().multiplyScalar(fit * 0.92), target: new THREE.Vector3(0, -1.5, 0) };
    return { pos: new THREE.Vector3(0.5, 0.78, 0.82).normalize().multiplyScalar(fit * 0.9), target: new THREE.Vector3(0, 0, 0.5) };
  }
  setView(kind, instant = false) {
    const p = this.viewPose(kind);
    if (instant || reducedMotion()) {
      this.camera.position.copy(p.pos);
      (this.controls?.target || this.camTarget || (this.camTarget = new THREE.Vector3())).copy(p.target);
      this.camera.lookAt(p.target);
      this.controls?.update();
      this.render();
      return;
    }
    this.tween = { from: this.camera.position.clone(), to: p.pos, tFrom: this.controls.target.clone(), tTo: p.target, t: 0 };
  }
  zoom(f) {
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t).multiplyScalar(f);
    const len = THREE.MathUtils.clamp(off.length(), this.controls.minDistance, this.controls.maxDistance);
    off.setLength(len);
    this.tween = { from: this.camera.position.clone(), to: t.clone().add(off), tFrom: t.clone(), tTo: t.clone(), t: 0 };
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.renderer.domElement.style.width = `${r.width}px`;
    this.renderer.domElement.style.height = `${r.height}px`;
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.vw = r.width; this.vh = r.height;
    if (!this.controls && this.size) this.setView(this.opts.hero ? 'hero' : 'iso', true);
    this.render();
  }

  // ---------------------------------------------------------------- world
  ensureWorld() {
    const c = this.src.sim.c;
    if (c === this.compiled) return;
    // same geometry if the cells are identical (e.g. a parameter reset)
    const sameCells = this.compiled && this.compiled.cells.length === c.cells.length && this.compiled.cells.every((v, i) => v === c.cells[i]) && this.compiled.layout.blocked.join() === c.layout.blocked.join();
    this.compiled = c;
    this.ensureAgents();
    if (sameCells) return;
    this.disposeWorld();
    this.buildWorld();
  }

  disposeWorld() {
    this.world.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
    });
    this.world.clear();
    this.labelHost.innerHTML = '';
    this.hlRing = null;
    this.hlLabel = null;
    this.agentMesh = null;
  }

  buildWorld() {
    const c = this.compiled;
    const { w, h, cells } = c;
    const W = w * CELL, H = h * CELL;
    this.size = { w: W, h: H };
    this.off = { x: -W / 2, z: -H / 2 };
    const X = (xm) => xm + this.off.x;
    const Z = (ym) => ym + this.off.z;
    const geo = (this.geo = planGeometry(c));
    const wallH = this.opts.wallHeight;

    // floor: the 2D drafting layer becomes the floor texture
    const ppm = this.opts.hero ? 24 : 36;
    const fc = document.createElement('canvas');
    fc.width = Math.round(W * ppm); fc.height = Math.round(H * ppm);
    const fctx = fc.getContext('2d');
    drawUnder(fctx, c, geo, { s: ppm, ox: 0, oy: 0 }, { bg: '#0c0e10', labels: true });
    const ftex = new THREE.CanvasTexture(fc);
    ftex.colorSpace = THREE.SRGBColorSpace;
    ftex.anisotropy = 4;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    this.world.add(floor);

    // density overlay (live DataTexture)
    this.heatData = new Uint8Array(w * h * 4);
    this.heatTex = new THREE.DataTexture(this.heatData, w, h, THREE.RGBAFormat);
    this.heatTex.magFilter = THREE.LinearFilter;
    this.heatTex.minFilter = THREE.LinearFilter;
    this.heatTex.colorSpace = THREE.SRGBColorSpace;
    this.heatTex.needsUpdate = true;
    this.heatMat = new THREE.MeshBasicMaterial({ map: this.heatTex, transparent: true, depthWrite: false, opacity: 1 });
    const heat = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.heatMat);
    heat.rotation.x = -Math.PI / 2;
    heat.position.y = 0.03;
    heat.renderOrder = 2;
    this.heatMesh = heat;
    this.world.add(heat);

    // walls: greedy rectangles → one merged geometry + edges
    const seen = new Uint8Array(w * h);
    const boxes = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (seen[i] || cells[i] !== T.WALL) continue;
        let x1 = x;
        while (x1 + 1 < w && cells[y * w + x1 + 1] === T.WALL && !seen[y * w + x1 + 1]) x1++;
        let y1 = y;
        outer: while (y1 + 1 < h) {
          for (let xx = x; xx <= x1; xx++) if (cells[(y1 + 1) * w + xx] !== T.WALL || seen[(y1 + 1) * w + xx]) break outer;
          y1++;
        }
        for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) seen[yy * w + xx] = 1;
        const bw = (x1 - x + 1) * CELL, bd = (y1 - y + 1) * CELL;
        const g = new THREE.BoxGeometry(bw, wallH, bd);
        g.translate(X(x * CELL + bw / 2), wallH / 2, Z(y * CELL + bd / 2));
        boxes.push(g);
      }
    if (boxes.length) {
      const merged = mergeGeometries(boxes);
      boxes.forEach((b) => b.dispose());
      this.wallMat = new THREE.MeshStandardMaterial({
        color: this.opts.glassWalls ? COL.wallGlass : COL.wall,
        roughness: 0.85,
        metalness: 0,
        transparent: this.opts.glassWalls,
        opacity: this.opts.glassWalls ? 0.32 : 1,
        depthWrite: !this.opts.glassWalls,
        emissive: new THREE.Color(0x000000),
      });
      const walls = new THREE.Mesh(merged, this.wallMat);
      walls.renderOrder = this.opts.glassWalls ? 5 : 0;
      this.world.add(walls);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 30), new THREE.LineBasicMaterial({ color: this.opts.glassWalls ? 0x8fd3c8 : COL.edge, transparent: true, opacity: this.opts.glassWalls ? 0.55 : 0.8 }));
      this.world.add(edges);
    }

    // stage
    let sx0 = Infinity, sy0 = Infinity, sx1 = -1, sy1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y * w + x] === T.STAGE) { sx0 = Math.min(sx0, x); sy0 = Math.min(sy0, y); sx1 = Math.max(sx1, x); sy1 = Math.max(sy1, y); }
    if (sx1 >= 0) {
      const sw = (sx1 - sx0 + 1) * CELL, sd = (sy1 - sy0 + 1) * CELL;
      const g = new THREE.BoxGeometry(sw, 0.6, sd);
      const stage = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: COL.stage, roughness: 0.7 }));
      stage.position.set(X(sx0 * CELL + sw / 2), 0.3, Z(sy0 * CELL + sd / 2));
      this.world.add(stage);
      const se = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x6b7178 }));
      se.position.copy(stage.position);
      this.world.add(se);
      // lectern
      const lect = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.45), new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 }));
      lect.position.set(X(sx0 * CELL + sw / 2), 0.6 + 0.55, Z(sy0 * CELL + sd * 0.7));
      this.world.add(lect);
    }

    // seats (instanced chair)
    const seatCells = [];
    const obstCells = [];
    for (let i = 0; i < w * h; i++) { if (cells[i] === T.SEAT) seatCells.push(i); else if (cells[i] === T.OBST) obstCells.push(i); }
    if (seatCells.length) {
      const parts = [
        new THREE.BoxGeometry(0.42, 0.07, 0.36).translate(0, 0.45, -0.02),
        new THREE.BoxGeometry(0.42, 0.42, 0.06).translate(0, 0.68, 0.17),
        new THREE.BoxGeometry(0.06, 0.45, 0.32).translate(-0.2, 0.22, 0),
        new THREE.BoxGeometry(0.06, 0.45, 0.32).translate(0.2, 0.22, 0),
      ];
      const chair = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      const mesh = new THREE.InstancedMesh(chair, new THREE.MeshStandardMaterial({ color: COL.seat, roughness: 0.75 }), seatCells.length);
      seatCells.forEach((cIdx, k) => {
        const x = cIdx % w, y = (cIdx - x) / w;
        this.dummy.position.set(X((x + 0.5) * CELL), 0, Z((y + 0.5) * CELL));
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(k, this.dummy.matrix);
      });
      this.world.add(mesh);
    }
    if (obstCells.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 0.9, CELL).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ color: COL.obst, roughness: 0.6 }), obstCells.length);
      obstCells.forEach((cIdx, k) => {
        const x = cIdx % w, y = (cIdx - x) / w;
        this.dummy.position.set(X((x + 0.5) * CELL), 0, Z((y + 0.5) * CELL));
        this.dummy.updateMatrix();
        mesh.setMatrixAt(k, this.dummy.matrix);
      });
      this.world.add(mesh);
    }

    // openings: jamb posts, door leaves, exit signs, blocked barriers, HTML labels
    this.openings = [];
    for (const g of c.groups) {
      const [nx, ny] = g.normal || [0, 1];
      const cx = X(g.cx), cz = Z(g.cy);
      const half = g.widthM / 2;
      const along = g.horizontal ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const mat = new THREE.MeshStandardMaterial({ color: g.blocked ? COL.red : g.type === 'exit' ? COL.teal : 0xbab3a6, emissive: new THREE.Color(g.blocked ? COL.red : g.type === 'exit' ? COL.teal : 0x000000), emissiveIntensity: g.type === 'exit' || g.blocked ? 0.55 : 0, roughness: 0.4 });
      const post = new THREE.BoxGeometry(0.12, wallH + 0.15, 0.12);
      for (const sgn of [-1, 1]) {
        const p = new THREE.Mesh(post, mat);
        p.position.set(cx + along.x * (half + 0.03) * sgn, (wallH + 0.15) / 2, cz + along.z * (half + 0.03) * sgn);
        this.world.add(p);
      }
      if (g.blocked) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(g.horizontal ? g.widthM : 0.18, wallH * 0.85, g.horizontal ? 0.18 : g.widthM), new THREE.MeshStandardMaterial({ color: COL.red, transparent: true, opacity: 0.55, emissive: new THREE.Color(COL.red), emissiveIntensity: 0.35 }));
        bar.position.set(cx, wallH * 0.425, cz);
        this.world.add(bar);
      } else if (g.type === 'door') {
        const leaves = g.widthM >= 1.5 ? 2 : 1;
        const lw = g.widthM / leaves;
        for (let k = 0; k < leaves; k++) {
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, wallH * 0.95, lw), new THREE.MeshStandardMaterial({ color: COL.door, roughness: 0.6 }));
          const hingeA = k === 0 ? -1 : 1;
          const hx = cx + along.x * half * hingeA, hz = cz + along.z * half * hingeA;
          // leaf swung 90° open into the egress side
          if (g.horizontal) leaf.position.set(hx, wallH * 0.475, hz + ny * (lw / 2 + CELL / 2));
          else { leaf.rotation.y = Math.PI / 2; leaf.position.set(hx + nx * (lw / 2 + CELL / 2), wallH * 0.475, hz); }
          this.world.add(leaf);
        }
      }
      if (g.type === 'exit' && !g.blocked) {
        const sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.1, g.widthM * 0.7), 0.3, 0.07), new THREE.MeshStandardMaterial({ color: 0x1fa58f, emissive: new THREE.Color(0x2fe0c3), emissiveIntensity: 0.9 }));
        sign.position.set(cx - nx * 0.05, wallH + 0.42, cz - ny * 0.05);
        if (!g.horizontal) sign.rotation.y = Math.PI / 2;
        this.world.add(sign);
      }
      const label = document.createElement('div');
      label.className = `v3d-label ${g.type} ${g.blocked ? 'blocked' : ''}`;
      this.labelHost.appendChild(label);
      this.openings.push({ g, mat, label, pos: new THREE.Vector3(cx + nx * 1.2, wallH + 0.9, cz + ny * 1.2) });
    }

    // bottleneck rings
    this.rings = [];
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff6b62, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      ring.visible = false;
      ring.renderOrder = 3;
      const lab = document.createElement('div');
      lab.className = 'v3d-label bn';
      lab.hidden = true;
      this.labelHost.appendChild(lab);
      this.world.add(ring);
      this.rings.push({ ring, lab });
    }

    // animated route highlights
    this.routeMat = new THREE.ShaderMaterial({ vertexShader: ROUTE_VS, fragmentShader: ROUTE_FS, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x45d6c2) }, uOpacity: { value: 0.85 } } });
    this.routes = new THREE.LineSegments(new THREE.BufferGeometry(), this.routeMat);
    this.routes.position.y = 0.08;
    this.routes.renderOrder = 4;
    this.world.add(this.routes);
    this.routeStamp = -1;

    this.agentMesh = null;
    this.ensureAgents();
  }

  ensureAgents() {
    const sim = this.src.sim;
    const N = Math.max(1, sim.N);
    if (this.agentMesh && this.agentCap >= N) return;
    if (this.agentMesh) { this.world.remove(this.agentMesh); this.agentMesh.geometry.dispose(); this.agentMesh.material.dispose(); }
    const parts = [
      new THREE.CylinderGeometry(0.15, 0.19, 1.05, 10).translate(0, 0.62, 0),
      new THREE.SphereGeometry(0.115, 12, 8).translate(0, 1.32, 0),
      new THREE.CylinderGeometry(0.1, 0.12, 0.12, 8).translate(0, 0.06, 0),
    ];
    const body = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    this.agentCap = Math.max(N, 400);
    this.agentMesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), this.agentCap);
    this.agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.agentCap; i++) this.agentMesh.setColorAt(i, this.tmpColor.set(COL.adult));
    this.agentMesh.frustumCulled = false;
    this.world.add(this.agentMesh);
  }

  // ---------------------------------------------------------------- per frame
  render() {
    if (!this.vw || !this.compiled) return;
    const sim = this.src.sim;
    if (sim.c !== this.compiled) this.ensureWorld();
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.time += dt;

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.85);
      const e = 1 - Math.pow(1 - tw.t, 3);
      this.camera.position.lerpVectors(tw.from, tw.to, e);
      this.controls.target.lerpVectors(tw.tFrom, tw.tTo, e);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls?.update();
    if (!this.controls) {
      if (this.opts.autoRotate && !reducedMotion()) {
        // slow architectural orbit around the model
        const p = this.camera.position;
        const ang = Math.atan2(p.z - this.camTarget.z, p.x - this.camTarget.x) + dt * 0.07;
        const rad = Math.hypot(p.x - this.camTarget.x, p.z - this.camTarget.z);
        p.x = this.camTarget.x + Math.cos(ang) * rad;
        p.z = this.camTarget.z + Math.sin(ang) * rad;
      }
      this.camera.lookAt(this.camTarget);
    }

    this.updateAgents(sim);
    this.updateHeat(sim, dt);
    this.updateOpenings(sim);
    this.updateBottlenecks(sim);
    this.updateHighlight();
    if (this.layers.flow) this.updateRoutes(sim);
    this.routes.visible = this.layers.flow;
    this.routeMat.uniforms.uTime.value = reducedMotion() ? 0 : this.time;

    // alarm: wall tops pulse red for the first seconds
    if (this.wallMat) {
      const alarm = sim.t > 0 && sim.t < 4 && !sim.done;
      const a = alarm ? 0.25 + 0.25 * Math.sin(this.time * 10) : 0;
      this.wallMat.emissive.setRGB(a * 0.9, a * 0.12, a * 0.1);
    }
    if (this.hud) {
      const phase = this.src.phase || '';
      this.hud.innerHTML = `<span class="chip ${phase === 'Alarm' ? 'red' : phase === 'Complete' ? 'teal' : 'amber'}">${sim.t > 0 && sim.t < 4 && !sim.done ? icon('alarm') : ''}${esc(phase || (sim.done ? 'Complete' : 'Live'))}</span><span class="mono">t = ${sim.t.toFixed(1)} s · ${sim.evacuated}/${sim.N} out</span>`;
    }
    this.renderer.render(this.scene, this.camera);
    this.positionLabels();
  }

  updateAgents(sim) {
    const mesh = this.agentMesh;
    if (!mesh) return;
    const a = this.src.alpha ?? 1;
    const d = this.dummy;
    const ox = this.off.x, oz = this.off.z;
    for (let i = 0; i < this.agentCap; i++) {
      if (i >= sim.N || sim.state[i] === STATE.EVACUATED) {
        d.position.set(0, -50, 0);
        d.scale.set(0.0001, 0.0001, 0.0001);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      const x = sim.px[i] + (sim.x[i] - sim.px[i]) * a;
      const y = sim.py[i] + (sim.y[i] - sim.py[i]) * a;
      const st = sim.state[i];
      const k = sim.cat[i];
      let col = k === 1 ? COL.slow : k === 2 ? COL.wheel : COL.adult;
      let sy = 1, sxz = 1, lift = 0;
      if (st === STATE.WAITING) {
        col = COL.wait;
        if (sim.seated[i]) { sy = 0.68; lift = 0.12; }
      } else if (st === STATE.TRAPPED) col = COL.red;
      else if (sim.congested[i]) col = COL.cong;
      if (k === 2) { sxz = 1.6; sy *= 0.82; }
      const sp = Math.hypot(sim.vx[i], sim.vy[i]);
      const bob = st === STATE.MOVING && sp > 0.2 ? Math.abs(Math.sin((x + y) * 5.2)) * 0.035 : 0;
      d.position.set(x + ox, lift + bob, y + oz);
      d.rotation.set(0, sp > 0.05 ? Math.atan2(sim.vx[i], sim.vy[i]) : 0, 0);
      d.scale.set(sxz, sy, sxz);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i, this.tmpColor.set(col));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  updateHeat(sim, dt) {
    if (!this.heatMesh) return;
    this.heatMesh.visible = this.layers.heat;
    if (!this.layers.heat) return;
    const { w, h, passable } = this.compiled;
    const map = sim.done ? sim.peakMap : sim.densityEMA;
    const data = this.heatData;
    for (let y = 0; y < h; y++) {
      const row = (h - 1 - y) * w;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = (row + x) * 4;
        if (!passable[i]) { data[o + 3] = 0; continue; }
        densityRGBA(map[i], data, o, 1.1);
      }
    }
    this.heatTex.needsUpdate = true;
    if (this.opts.hero) this.heatAlpha = Math.min(1, this.heatAlpha + dt / 8);
    this.heatMat.opacity = this.heatAlpha;
  }

  updateOpenings(sim) {
    for (const o of this.openings || []) {
      const g = o.g;
      const q = sim.gateQueue[g.id];
      const n = sim.gatePasses[g.id].length;
      const state = g.blocked ? 'blocked' : q >= 4 ? 'queue' : 'open';
      if (!g.blocked) {
        const pulse = state === 'queue' ? 0.45 + 0.35 * Math.sin(this.time * 6) : g.type === 'exit' ? 0.55 : 0.05;
        o.mat.color.set(state === 'queue' ? COL.amber : g.type === 'exit' ? COL.teal : 0xbab3a6);
        o.mat.emissive.set(state === 'queue' ? COL.amber : g.type === 'exit' ? COL.teal : 0x000000);
        o.mat.emissiveIntensity = pulse;
      }
      o.label.hidden = !this.layers.chips || !this.opts.labels;
      const txt = g.blocked ? `${g.name} · blocked` : `${g.name} · ${n}${q ? ` · q${q}` : ''}`;
      if (o.label.textContent !== txt) o.label.textContent = txt;
      o.label.dataset.state = state;
    }
  }

  updateBottlenecks(sim) {
    const list = this.layers.bottlenecks && !sim.done ? sim.liveBottlenecks.slice(0, 3) : [];
    this.rings.forEach((r, k) => {
      const b = list[k];
      r.ring.visible = !!b;
      r.lab.hidden = !b || !this.opts.labels;
      if (!b) return;
      const rad = Math.max(0.9, Math.sqrt(b.areaM2 / Math.PI) + 0.5);
      const pulse = 1 + 0.06 * Math.sin(this.time * 4 + k);
      r.ring.scale.setScalar(rad * pulse);
      r.ring.position.x = b.x + this.off.x;
      r.ring.position.z = b.y + this.off.z;
      r.pos = new THREE.Vector3(b.x + this.off.x, 1.9, b.y + this.off.z);
      r.lab.textContent = `B${k + 1} · ${b.peak.toFixed(1)} p/m²`;
    });
  }

  /** ring + label at the controller's highlighted location, if any */
  updateHighlight() {
    const hl = this.src.hl;
    if (!this.hlRing) {
      this.hlRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
      this.hlRing.rotation.x = -Math.PI / 2;
      this.hlRing.position.y = 0.09;
      this.hlRing.renderOrder = 6;
      this.world.add(this.hlRing);
      this.hlLabel = document.createElement('div');
      this.hlLabel.className = 'v3d-label hl';
      this.labelHost.appendChild(this.hlLabel);
    }
    const on = !!(hl && hl.x != null && this.off);
    this.hlRing.visible = on;
    this.hlLabel.hidden = !on || !hl.label;
    if (!on) return;
    const r = Math.max(1, hl.radius || 1.5) * (1 + 0.06 * Math.sin(this.time * 5));
    this.hlRing.scale.setScalar(r);
    this.hlRing.position.x = hl.x + this.off.x;
    this.hlRing.position.z = hl.y + this.off.z;
    this.hlPos = new THREE.Vector3(hl.x + this.off.x, 2.2, hl.y + this.off.z);
    if (this.hlLabel.textContent !== hl.label) this.hlLabel.textContent = hl.label || '';
  }

  /** trace the planned routes of a sample of moving agents down their exit field */
  updateRoutes(sim) {
    const stamp = Math.floor(sim.t);
    if (stamp === this.routeStamp && sim.fieldVersion === this.routeField) return;
    this.routeStamp = stamp;
    this.routeField = sim.fieldVersion;
    const { w, h, passable } = this.compiled;
    const pos = [];
    const dist = [];
    const step = Math.max(1, Math.floor(sim.N / 45));
    for (let i = 0; i < sim.N; i += step) {
      if (sim.state[i] !== STATE.MOVING || sim.exitSel[i] < 0) continue;
      const f = sim.fields[sim.exitSel[i]];
      let c = sim.navCell(i);
      if (c < 0) continue;
      let px = sim.x[i] + this.off.x, pz = sim.y[i] + this.off.z;
      let acc = 0;
      for (let k = 0; k < 140 && f[c] > 0.01; k++) {
        const x = c % w, y = (c - x) / w;
        let best = c, bv = f[c];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (passable[j] && f[j] < bv) { bv = f[j]; best = j; }
          }
        if (best === c) break;
        c = best;
        const nxp = ((c % w) + 0.5) * CELL + this.off.x, nzp = (Math.floor(c / w) + 0.5) * CELL + this.off.z;
        pos.push(px, 0, pz, nxp, 0, nzp);
        const seg = Math.hypot(nxp - px, nzp - pz);
        dist.push(acc, acc + seg);
        acc += seg;
        px = nxp; pz = nzp;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('lineDistance', new THREE.Float32BufferAttribute(dist, 1));
    this.routes.geometry.dispose();
    this.routes.geometry = g;
  }

  positionLabels() {
    if (!this.opts.labels) return;
    const v = new THREE.Vector3();
    const place = (el, p) => {
      if (!p || el.hidden) return;
      v.copy(p).project(this.camera);
      if (v.z > 1) { el.style.opacity = 0; return; }
      el.style.opacity = 1;
      el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * this.vw}px, ${((1 - v.y) / 2) * this.vh}px)`;
    };
    for (const o of this.openings || []) place(o.label, o.pos);
    for (const r of this.rings || []) place(r.lab, r.pos);
    if (this.hlLabel && this.hlPos) place(this.hlLabel, this.hlPos);
  }

  destroy() {
    this.unsub();
    this.ro.disconnect();
    this.controls?.dispose();
    this.disposeWorld();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.host.innerHTML = '';
  }
}
