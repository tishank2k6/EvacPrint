// Interactive learning labs. Lightweight and independent of the main
// simulator; the width and exit labs run the real engine on small rooms.
import { icon } from '../ui/icons.js';
import { esc, syncRange, watchVisible } from '../ui/dom.js';
import { dijkstraTrace, distanceField } from '../sim/pathfinding.js';
import { weidmannFactor, losFor, MODEL, Simulation } from '../sim/engine.js';
import { miniRoom, compile } from './mini.js';
import { LoopDriver } from '../render/iso.js';
import { FloorPlan2D } from '../render/floorplan.js';
import { densityRGBA, BAND, bandOf, BAND_LABEL } from '../render/colors.js';
import { CELL } from '../sim/layout.js';

const fitCanvas = (cv) => {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height };
};

// ---------------------------------------------------------------- A. Dijkstra
export function dijkstraLab(host) {
  host.innerHTML = `
    <div class="lab-head"><h3>${icon('route')}Dijkstra pathfinding</h3><p>Drag to draw walls. Choose a tool to move the start (white) or the exit (teal), then run the search and watch it expand.</p></div>
    <div class="lab-stage"><canvas></canvas></div>
    <div class="lab-ctrl">
      <div class="row gap8 wrap-row">
        <div class="seg" role="group" aria-label="Tool"><button data-tool="wall" aria-pressed="true">Wall</button><button data-tool="start" aria-pressed="false">Start</button><button data-tool="goal" aria-pressed="false">Exit</button></div>
        <div class="seg" role="group" aria-label="Neighbourhood"><button data-mode="8" aria-pressed="true">8 directions</button><button data-mode="4" aria-pressed="false">4 directions (BFS)</button></div>
        <button class="btn sm primary" data-run>${icon('play')}Run search</button>
        <button class="btn sm ghost" data-clear>${icon('reset')}Clear walls</button>
      </div>
      <div class="lab-read"><span>Settled <b data-settled>—</b></span><span>Path cost <b data-cost>—</b></span><span>Steps <b data-steps>—</b></span></div>
    </div>`;
  const cv = host.querySelector('canvas');
  const w = 24, h = 14;
  const open = new Uint8Array(w * h).fill(1);
  for (let y = 2; y < 11; y++) open[y * w + 9] = 0;
  for (let y = 4; y < 14; y++) open[y * w + 15] = 0;
  let start = 6 * w + 2, goal = 7 * w + 21;
  let tool = 'wall', mode = 8, res = null, anim = 0, raf = 0, paintVal = 0;
  const trace4 = () => {
    // breadth-first search on 4 neighbours (unit costs)
    const dist = new Float32Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1), order = [];
    const q = [goal]; dist[goal] = 0;
    while (q.length) {
      const c = q.shift(); order.push(c);
      if (c === start) break;
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (!open[j] || dist[j] < Infinity) continue;
        dist[j] = dist[c] + 1; prev[j] = c; q.push(j);
      }
    }
    const path = []; if (dist[start] < Infinity) for (let c = start; c !== -1; c = prev[c]) path.push(c);
    return { order, path, dist };
  };
  const run = () => {
    res = mode === 8 ? (() => { const r = dijkstraTrace(w, h, open, goal, start); return { ...r, path: r.path.slice().reverse() }; })() : trace4();
    anim = 0;
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = (now) => { anim = Math.min(1, (now - t0) / 1600); draw(); if (anim < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  };
  const geom = () => { const { W, H } = { W: cv.clientWidth, H: cv.clientHeight }; const cs = Math.min((W - 20) / w, (H - 20) / h); return { cs, ox: (W - cs * w) / 2, oy: (H - cs * h) / 2 }; };
  let ctxW;
  const draw = () => {
    const { ctx } = ctxW || (ctxW = fitCanvas(cv));
    const { cs, ox, oy } = geom();
    ctx.fillStyle = '#111316'; ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
    const n = res ? Math.floor(res.order.length * anim) : 0;
    const settled = new Set(res ? res.order.slice(0, n) : []);
    let max = 1; if (res) for (const c of res.order) max = Math.max(max, res.dist[c]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      ctx.fillStyle = !open[i] ? '#d4cdc0' : settled.has(i) ? `rgba(47,184,166,${(0.55 * (1 - res.dist[i] / max) + 0.1).toFixed(3)})` : '#1a1d21';
      ctx.fillRect(ox + x * cs, oy + y * cs, cs - 1, cs - 1);
    }
    if (res && anim >= 1 && res.path.length) {
      ctx.strokeStyle = '#e3a03a'; ctx.lineWidth = 3; ctx.beginPath();
      res.path.forEach((c, i) => { const x = ox + (c % w) * cs + cs / 2, y = oy + Math.floor(c / w) * cs + cs / 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    const dot = (c, col, sq) => { const x = ox + (c % w) * cs + cs / 2, y = oy + Math.floor(c / w) * cs + cs / 2; ctx.fillStyle = col; ctx.beginPath(); sq ? ctx.rect(x - cs * 0.38, y - cs * 0.38, cs * 0.76, cs * 0.76) : ctx.arc(x, y, cs * 0.34, 0, Math.PI * 2); ctx.fill(); };
    dot(goal, '#2fb8a6', true); dot(start, '#ece6da', false);
    host.querySelector('[data-settled]').textContent = res ? `${n} / ${w * h - [...open].filter((v) => !v).length}` : '—';
    const reach = res && res.path.length;
    host.querySelector('[data-cost]').textContent = res && anim >= 1 ? (reach ? `${(mode === 8 ? res.dist[start] : res.path.length - 1).toFixed(2)} cells` : 'no route') : '—';
    host.querySelector('[data-steps]').textContent = res && anim >= 1 && reach ? res.path.length - 1 : '—';
  };
  const cellAt = (e) => { const r = cv.getBoundingClientRect(); const { cs, ox, oy } = geom(); const x = Math.floor((e.clientX - r.left - ox) / cs), y = Math.floor((e.clientY - r.top - oy) / cs); return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1; };
  let down = false;
  cv.addEventListener('pointerdown', (e) => {
    const c = cellAt(e); if (c < 0) return;
    cv.setPointerCapture(e.pointerId);
    if (tool === 'wall') { if (c === start || c === goal) return; down = true; paintVal = open[c] ? 0 : 1; open[c] = paintVal; }
    else if (open[c]) { if (tool === 'start') start = c; else goal = c; }
    res = null; draw();
  });
  cv.addEventListener('pointermove', (e) => { if (!down) return; const c = cellAt(e); if (c >= 0 && c !== start && c !== goal) { open[c] = paintVal; res = null; draw(); } });
  cv.addEventListener('pointerup', () => (down = false));
  host.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { tool = b.dataset.tool; host.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = +b.dataset.mode; host.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); res = null; draw(); }));
  host.querySelector('[data-run]').addEventListener('click', run);
  host.querySelector('[data-clear]').addEventListener('click', () => { open.fill(1); res = null; draw(); });
  const ro = new ResizeObserver(() => { ctxW = null; draw(); });
  ro.observe(cv);
  return () => { ro.disconnect(); cancelAnimationFrame(raf); };
}

// ---------------------------------------------------------------- B. corridor / opening width (real engine)
export function widthLab(host) {
  host.innerHTML = `
    <div class="lab-head"><h3>${icon('bottleneck')}Bottleneck width</h3><p>60 people must pass through an opening in a partition. Change its width and the real engine re-runs: watch the queue and the measured flow.</p></div>
    <div class="lab-stage"></div>
    <div class="lab-ctrl">
      <div class="field"><div class="label"><span>Opening width</span><span class="val" data-wv>1.0 m</span></div><input type="range" min="1" max="6" step="1" value="2" data-w aria-label="Opening width"></div>
      <div class="lab-read"><span>Capacity <b data-cap>—</b></span><span>Measured flow <b data-flow>—</b></span><span>Through <b data-thr>—</b></span><span>All out at <b data-done>—</b></span></div>
    </div>`;
  const stage = host.querySelector('.lab-stage');
  let driver, view;
  const build = (cells) => {
    view?.destroy(); driver?.stop();
    const L = miniRoom({ w: 34, h: 20, partitions: [{ x: 18, y0: 1, y1: 18 }], openings: [{ side: 'p', x: 18, at: 10 - Math.floor(cells / 2), width: cells, type: 'door', name: 'Opening' }, { side: 'e', at: 7, width: 6, name: 'Exit' }], spawn: { x0: 3, y0: 3, x1: 15, y1: 16 } });
    driver = new LoopDriver(() => new Simulation(L, { occupants: 60, reactionMin: 0, reactionMax: 3, seed: 9, panic: 0.2 }), { speed: 2.5, holdEnd: 2.5 });
    view = new FloorPlan2D(stage, driver, { compact: true, interactive: true, layers: { chips: false } });
    host.querySelector('[data-cap]').textContent = `${(cells * CELL * MODEL.specificFlow).toFixed(2)} p/s`;
  };
  const inp = host.querySelector('[data-w]');
  const apply = () => { syncRange(inp); host.querySelector('[data-wv]').textContent = `${(inp.value * CELL).toFixed(1)} m`; build(+inp.value); };
  inp.addEventListener('input', () => { syncRange(inp); host.querySelector('[data-wv]').textContent = `${(inp.value * CELL).toFixed(1)} m`; });
  inp.addEventListener('change', apply);
  apply();
  const iv = setInterval(() => {
    const s = driver.sim; const g = s.c.groups.find((x) => x.name === 'Opening'); const p = s.gatePasses[g.id];
    const flow = p.length > 5 ? (p.length - 1) / Math.max(0.1, p.at(-1) - p[0]) : 0;
    host.querySelector('[data-flow]').textContent = p.length > 5 ? `${flow.toFixed(2)} p/s` : '—';
    host.querySelector('[data-thr]').textContent = `${p.length} / ${s.N}`;
    host.querySelector('[data-done]').textContent = s.done ? `${s.t.toFixed(1)} s` : 'running…';
  }, 250);
  const stopVis = watchVisible(stage, (v) => { if (driver) driver.visible = v; });
  return () => { clearInterval(iv); view?.destroy(); driver?.stop(); stopVis(); };
}

// ---------------------------------------------------------------- C. density
export function densityLab(host) {
  host.innerHTML = `
    <div class="lab-head"><h3>${icon('heat')}Density heatmap</h3><p>Add people to a fixed 6 × 6 m area. The heatmap uses the engine’s Gaussian-kernel density; speed comes from the Weidmann curve.</p></div>
    <div class="lab-stage"><canvas></canvas></div>
    <div class="lab-ctrl">
      <div class="field"><div class="label"><span>People in the area</span><span class="val" data-nv>40</span></div><input type="range" min="5" max="190" step="5" value="40" data-n aria-label="People"></div>
      <div class="lab-read"><span>Mean density <b data-md>—</b></span><span>Peak (kernel) <b data-pk>—</b></span><span>Walking speed <b data-v>—</b></span><span>Level <b data-los>—</b></span></div>
    </div>`;
  const cv = host.querySelector('canvas');
  const A = 6, R = MODEL.kernelR, res = 0.25, G = Math.round(A / res);
  let pts = [];
  const seed = (n) => {
    while (pts.length < n) pts.push({ x: 0.3 + Math.random() * (A - 0.6), y: 0.3 + Math.random() * (A - 0.6), a: Math.random() * 6.28 });
    pts.length = n;
  };
  const inp = host.querySelector('[data-n]');
  let raf = 0, visible = true, ctxW = null;
  const heat = Object.assign(document.createElement('canvas'), { width: G, height: G });
  const img = heat.getContext('2d').createImageData(G, G);
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const n = +inp.value;
    seed(n);
    const mean = n / (A * A);
    const v = 1.34 * weidmannFactor(mean);
    // jitter + soft separation
    for (const p of pts) { p.a += (Math.random() - 0.5) * 0.4; p.x += Math.cos(p.a) * v * 0.004; p.y += Math.sin(p.a) * v * 0.004; }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j]; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1e-3;
      if (d < 0.42) { const o = (0.42 - d) / 2; a.x -= (dx / d) * o; a.y -= (dy / d) * o; b.x += (dx / d) * o; b.y += (dy / d) * o; }
    }
    for (const p of pts) { p.x = Math.max(0.22, Math.min(A - 0.22, p.x)); p.y = Math.max(0.22, Math.min(A - 0.22, p.y)); }
    let pk = 0;
    const d = img.data;
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const cx = (gx + 0.5) * res, cy = (gy + 0.5) * res;
      let s = 0;
      for (const p of pts) { const q = (p.x - cx) ** 2 + (p.y - cy) ** 2; if (q < 4 * R * R) s += Math.exp(-q / (R * R)); }
      s /= Math.PI * R * R;
      // edge correction: only the part of the kernel inside the area counts
      pk = Math.max(pk, s);
      densityRGBA(s, d, (gy * G + gx) * 4);
    }
    heat.getContext('2d').putImageData(img, 0, 0);
    const { ctx, W, H } = ctxW || (ctxW = fitCanvas(cv));
    ctx.fillStyle = '#111316'; ctx.fillRect(0, 0, W, H);
    const sz = Math.min(W, H) - 30, ox = (W - sz) / 2, oy = (H - sz) / 2, k = sz / A;
    ctx.fillStyle = '#191c20'; ctx.fillRect(ox, oy, sz, sz);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(heat, ox, oy, sz, sz);
    ctx.strokeStyle = '#d4cdc0'; ctx.lineWidth = 3; ctx.strokeRect(ox, oy, sz, sz);
    ctx.fillStyle = '#ece6da';
    for (const p of pts) { ctx.beginPath(); ctx.arc(ox + p.x * k, oy + p.y * k, Math.max(2, 0.2 * k), 0, Math.PI * 2); ctx.fill(); }
    host.querySelector('[data-md]').textContent = `${mean.toFixed(2)} p/m²`;
    host.querySelector('[data-pk]').textContent = `${pk.toFixed(2)} p/m²`;
    host.querySelector('[data-v]').textContent = `${v.toFixed(2)} m/s`;
    const b = bandOf(mean);
    host.querySelector('[data-los]').innerHTML = `<i class="pk-dot" style="background:${BAND[b]};margin:0 6px 0 0"></i>${BAND_LABEL[b]} · LOS ${losFor(mean)}`;
  };
  inp.addEventListener('input', () => { syncRange(inp); host.querySelector('[data-nv]').textContent = inp.value; });
  syncRange(inp);
  const stopVis = watchVisible(cv, (v) => (visible = v));
  const ro = new ResizeObserver(() => (ctxW = null)); ro.observe(cv);
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); stopVis(); ro.disconnect(); };
}

// ---------------------------------------------------------------- D. exit comparison (real engine)
export function exitLab(host) {
  const exits = ['North exit', 'East exit', 'South exit'];
  host.innerHTML = `
    <div class="lab-head"><h3>${icon('exit')}Exit comparison</h3><p>Block an exit and the distance fields are recomputed: arrows show the new routes and 70 agents re-run with the real engine.</p></div>
    <div class="lab-stage"></div>
    <div class="lab-ctrl">
      <div class="row gap8 wrap-row">${exits.map((n) => `<button class="btn sm" data-ex="${n}" aria-pressed="true">${icon('exit')}${n}: open</button>`).join('')}</div>
      <div class="lab-read" data-counts></div>
    </div>`;
  const stage = host.querySelector('.lab-stage');
  const blocked = new Set();
  let driver, view;
  const build = () => {
    view?.destroy(); driver?.stop();
    const L = miniRoom({ w: 34, h: 22, openings: [{ side: 'n', at: 8, width: 3, name: 'North exit' }, { side: 'e', at: 9, width: 3, name: 'East exit' }, { side: 's', at: 24, width: 2, name: 'South exit' }], spawn: { x0: 3, y0: 3, x1: 30, y1: 18 } });
    L.blocked = [...blocked];
    driver = new LoopDriver(() => new Simulation(L, { occupants: 70, reactionMin: 0, reactionMax: 5, seed: 4, panic: 0.2 }), { speed: 2.2, holdEnd: 2.5 });
    view = new FloorPlan2D(stage, driver, { compact: true, interactive: true, layers: { flow: true, chips: false } });
  };
  host.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
    const n = b.dataset.ex;
    if (!blocked.has(n) && blocked.size >= 2) return; // keep at least one exit
    blocked.has(n) ? blocked.delete(n) : blocked.add(n);
    b.setAttribute('aria-pressed', String(!blocked.has(n)));
    b.classList.toggle('danger', blocked.has(n));
    b.innerHTML = `${icon('exit')}${n}: ${blocked.has(n) ? 'blocked' : 'open'}`;
    build();
  }));
  build();
  const iv = setInterval(() => {
    const s = driver.sim;
    host.querySelector('[data-counts]').innerHTML = s.c.groups.map((g) => `<span>${esc(g.name)} <b>${g.blocked ? 'blocked' : s.gatePasses[g.id].length}</b></span>`).join('') + `<span>Time <b>${s.t.toFixed(1)} s</b></span>`;
  }, 250);
  const stopVis = watchVisible(stage, (v) => { if (driver) driver.visible = v; });
  return () => { clearInterval(iv); view?.destroy(); driver?.stop(); stopVis(); };
}

export const LABS = [
  { id: 'dijkstra', mount: dijkstraLab },
  { id: 'width', mount: widthLab },
  { id: 'density', mount: densityLab },
  { id: 'exits', mount: exitLab },
];
void distanceField; void compile;
