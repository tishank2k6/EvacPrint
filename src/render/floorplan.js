// 2D architectural floor-plan renderer (Canvas 2D).
// Static linework (floor, seats, walls, door swings, dimensions) is cached in
// two offscreen layers; per frame only the density field, agents and markers
// are drawn. Positions are interpolated between simulation steps for smooth
// motion at any playback speed.
import { CELL, T, compile } from '../sim/layout.js';
import { distanceField } from '../sim/pathfinding.js';
import { STATE, MODEL, losFor, CATEGORY } from '../sim/engine.js';
import { densityRGBA, AGENT_COLORS, BAND_LABEL, bandOf } from './colors.js';
import { showTip, hideTip, esc } from '../ui/dom.js';

const C = {
  bg: '#111316',
  floor: '#191c20',
  floor2: '#1c2024',
  grid: 'rgba(236,230,218,0.035)',
  grid2: 'rgba(236,230,218,0.07)',
  wall: '#d4cdc0',
  wallEdge: '#ece6da',
  seat: '#353b42',
  seatBack: '#59616b',
  stage: '#22272c',
  hatch: 'rgba(236,230,218,0.09)',
  obst: '#2b3036',
  door: '#9c968b',
  teal: '#2fb8a6',
  amber: '#e3a03a',
  red: '#e0524a',
  ink: '#ece6da',
  ink3: '#847e74',
  dim: 'rgba(236,230,218,0.45)',
};

/** Geometry shared by live and static renderers. */
export function planGeometry(compiled) {
  const { w, h, cells, passable, groups } = compiled;
  // egress side of each opening: the side closer (by path) to any exit
  const exitCells = groups.filter((g) => g.type === 'exit' && !g.blocked).flatMap((g) => g.cells);
  const open = { ...compiled, passable: new Uint8Array(passable) };
  for (const g of groups) for (const c of g.cells) open.passable[c] = 1; // treat blocked as open for orientation only
  const allExits = groups.filter((g) => g.type === 'exit').flatMap((g) => g.cells);
  const field = distanceField(open, exitCells.length ? exitCells : allExits, null, null);
  for (const g of groups) {
    const { minX, maxX, minY, maxY } = g.bounds;
    let a, b; // sample cells on each side
    if (g.horizontal) { a = (minY - 1) * w + minX; b = (maxY + 1) * w + minX; }
    else { a = minY * w + (minX - 1); b = minY * w + (maxX + 1); }
    const va = cells[a] === T.VOID ? -1 : field[a];
    const vb = cells[b] === T.VOID ? -1 : field[b];
    // egress = towards the smaller value (VOID = outside = -1)
    const towardsB = vb < va;
    g.normal = g.horizontal ? [0, towardsB ? 1 : -1] : [towardsB ? 1 : -1, 0];
  }
  // horizontal wall runs
  const walls = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (cells[y * w + x] === T.WALL) {
        let x1 = x;
        while (x1 + 1 < w && cells[y * w + x1 + 1] === T.WALL) x1++;
        walls.push([x, y, x1 - x + 1]);
        x = x1 + 1;
      } else x++;
    }
  }
  return { walls, field };
}

export function computeFit(compiled, cw, ch, pad) {
  const W = compiled.w * CELL, H = compiled.h * CELL;
  const s = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H);
  return { s, ox: (cw - W * s) / 2, oy: (ch - H * s) / 2, cw, ch };
}

function hatch(ctx, x, y, w, h, step, color) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -h; k < w; k += step) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); }
  ctx.stroke();
  ctx.restore();
}

/** floor, grid, furniture */
export function drawUnder(ctx, compiled, geo, f, opts = {}) {
  const { w, h, cells } = compiled;
  const { s, ox, oy } = f;
  const cs = CELL * s;
  ctx.fillStyle = opts.bg || C.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // floor
  ctx.fillStyle = C.floor;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = cells[y * w + x];
      if (t !== T.VOID && t !== T.WALL) ctx.fillRect(ox + x * cs - 0.3, oy + y * cs - 0.3, cs + 0.6, cs + 0.6);
    }
  // drafting grid: 0.5 m minor, 5 m major
  if (opts.grid !== false && cs > 5) {
    ctx.lineWidth = 1;
    for (let k = 0; k <= Math.max(w, h); k++) {
      ctx.strokeStyle = k % 10 === 0 ? C.grid2 : C.grid;
      if (k <= w) { ctx.beginPath(); ctx.moveTo(Math.round(ox + k * cs) + 0.5, oy); ctx.lineTo(Math.round(ox + k * cs) + 0.5, oy + h * cs); ctx.stroke(); }
      if (k <= h) { ctx.beginPath(); ctx.moveTo(ox, Math.round(oy + k * cs) + 0.5); ctx.lineTo(ox + w * cs, Math.round(oy + k * cs) + 0.5); ctx.stroke(); }
    }
  }
  // stage
  let sx0 = Infinity, sy0 = Infinity, sx1 = -1, sy1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (cells[y * w + x] === T.STAGE) { sx0 = Math.min(sx0, x); sy0 = Math.min(sy0, y); sx1 = Math.max(sx1, x); sy1 = Math.max(sy1, y); }
  if (sx1 >= 0) {
    ctx.fillStyle = C.stage;
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) if (cells[y * w + x] === T.STAGE) ctx.fillRect(ox + x * cs, oy + y * cs, cs + 0.5, cs + 0.5);
    hatch(ctx, ox + sx0 * cs, oy + sy0 * cs, (sx1 - sx0 + 1) * cs, (sy1 - sy0 + 1) * cs, Math.max(5, cs * 0.6), C.hatch);
    ctx.strokeStyle = 'rgba(236,230,218,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + sx0 * cs + 0.5, oy + sy0 * cs + 0.5, (sx1 - sx0 + 1) * cs - 1, (sy1 - sy0 + 1) * cs - 1);
    if (cs > 6) {
      ctx.fillStyle = 'rgba(236,230,218,0.5)';
      ctx.font = `500 ${Math.max(9, cs * 0.7)}px "IBM Plex Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S T A G E', ox + ((sx0 + sx1 + 1) / 2) * cs, oy + ((sy0 + sy1 + 1) / 2) * cs);
    }
  }
  // seats (audience faces north: backrest on the south edge)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = cells[y * w + x];
      const px = ox + x * cs, py = oy + y * cs;
      if (t === T.SEAT) {
        const m = cs * 0.12;
        ctx.fillStyle = C.seat;
        roundRect(ctx, px + m, py + m, cs - 2 * m, cs - 2 * m * 1.2, cs * 0.12);
        ctx.fill();
        ctx.fillStyle = C.seatBack;
        ctx.fillRect(px + m, py + cs - m * 2.1, cs - 2 * m, Math.max(1, cs * 0.14));
      } else if (t === T.OBST) {
        ctx.fillStyle = C.obst;
        ctx.fillRect(px, py, cs + 0.5, cs + 0.5);
        hatch(ctx, px, py, cs, cs, Math.max(4, cs * 0.35), 'rgba(227,160,58,0.25)');
        ctx.strokeStyle = 'rgba(227,160,58,0.5)';
        ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
      }
    }
  // region labels
  if (opts.labels !== false && cs > 7) {
    ctx.font = `500 ${Math.max(8.5, cs * 0.5)}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(236,230,218,0.22)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of compiled.layout.meta.regions || []) {
      if (!/corridor/i.test(r.name)) continue;
      const cx = ox + ((r.x0 + r.x1 + 1) / 2) * cs, cy = oy + ((r.y0 + r.y1 + 1) / 2) * cs;
      ctx.save();
      ctx.translate(cx, cy);
      if (r.y1 - r.y0 > r.x1 - r.x0) ctx.rotate(-Math.PI / 2);
      ctx.fillText(r.name.toUpperCase().split('').join(' '), 0, 0);
      ctx.restore();
    }
  }
}

/** walls, openings, dimensions */
export function drawOver(ctx, compiled, geo, f, opts = {}) {
  const { w, h, groups } = compiled;
  const { s, ox, oy } = f;
  const cs = CELL * s;
  // walls (poché)
  ctx.fillStyle = C.wall;
  for (const [x, y, n] of geo.walls) ctx.fillRect(ox + x * cs - 0.25, oy + y * cs - 0.25, n * cs + 0.5, cs + 0.5);

  // openings
  for (const g of groups) {
    const { minX, maxX, minY, maxY } = g.bounds;
    const x0 = ox + minX * cs, y0 = oy + minY * cs;
    const gw = (maxX - minX + 1) * cs, gh = (maxY - minY + 1) * cs;
    ctx.fillStyle = C.floor;
    ctx.fillRect(x0, y0, gw, gh);
    const [nx, ny] = g.normal || [0, 1];
    const len = g.horizontal ? gw : gh;
    // jamb ticks
    ctx.strokeStyle = C.wallEdge;
    ctx.lineWidth = Math.max(1, cs * 0.08);
    if (g.blocked) {
      ctx.fillStyle = 'rgba(224,82,74,0.22)';
      ctx.fillRect(x0, y0, gw, gh);
      ctx.strokeStyle = C.red;
      ctx.lineWidth = Math.max(1.5, cs * 0.12);
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + gw, y0 + gh);
      ctx.moveTo(x0 + gw, y0); ctx.lineTo(x0, y0 + gh);
      ctx.stroke();
      ctx.strokeRect(x0, y0, gw, gh);
      continue;
    }
    if (g.type === 'exit') {
      // exit: teal threshold + outward chevron
      ctx.fillStyle = 'rgba(47,184,166,0.25)';
      ctx.fillRect(x0, y0, gw, gh);
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = Math.max(2, cs * 0.16);
      ctx.beginPath();
      if (g.horizontal) { const yy = ny > 0 ? y0 + gh : y0; ctx.moveTo(x0, yy); ctx.lineTo(x0 + gw, yy); }
      else { const xx = nx > 0 ? x0 + gw : x0; ctx.moveTo(xx, y0); ctx.lineTo(xx, y0 + gh); }
      ctx.stroke();
      const cx = x0 + gw / 2 + nx * cs * 1.15, cy = y0 + gh / 2 + ny * cs * 1.15;
      const a = cs * 0.45;
      ctx.lineWidth = Math.max(1.5, cs * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx - ny * a - nx * a * 0.6, cy - nx * a - ny * a * 0.6);
      ctx.lineTo(cx + nx * a * 0.4, cy + ny * a * 0.4);
      ctx.lineTo(cx + ny * a - nx * a * 0.6, cy + nx * a - ny * a * 0.6);
      ctx.stroke();
    } else {
      // door: leaf + swing arc into the egress side (architectural symbol)
      const leaves = len / cs >= 3 ? 2 : 1;
      const leafLen = len / leaves;
      ctx.strokeStyle = C.door;
      ctx.lineWidth = Math.max(1, cs * 0.07);
      for (let k = 0; k < leaves; k++) {
        let hx, hy, ex, ey, start, end, ccw;
        if (g.horizontal) {
          const edgeY = ny > 0 ? y0 + gh : y0;
          const right = k === 1;
          hx = right ? x0 + gw : x0; hy = edgeY;
          ex = hx; ey = hy + ny * leafLen;
          const toward = Math.atan2(ny, 0), across = right ? Math.PI : 0;
          start = toward; end = across;
          ccw = (ny > 0) === right ? false : true;
          if (ny > 0 && !right) { start = Math.PI / 2; end = 0; ccw = true; }
          if (ny > 0 && right) { start = Math.PI / 2; end = Math.PI; ccw = false; }
          if (ny < 0 && !right) { start = -Math.PI / 2; end = 0; ccw = false; }
          if (ny < 0 && right) { start = -Math.PI / 2; end = -Math.PI; ccw = true; }
        } else {
          const edgeX = nx > 0 ? x0 + gw : x0;
          const bottom = k === 1;
          hx = edgeX; hy = bottom ? y0 + gh : y0;
          ex = hx + nx * leafLen; ey = hy;
          if (nx > 0 && !bottom) { start = 0; end = Math.PI / 2; ccw = false; }
          if (nx > 0 && bottom) { start = 0; end = -Math.PI / 2; ccw = true; }
          if (nx < 0 && !bottom) { start = Math.PI; end = Math.PI / 2; ccw = true; }
          if (nx < 0 && bottom) { start = Math.PI; end = Math.PI * 1.5; ccw = false; }
        }
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.save();
        ctx.setLineDash([Math.max(2, cs * 0.12), Math.max(2, cs * 0.12)]);
        ctx.lineWidth = Math.max(0.75, cs * 0.045);
        ctx.beginPath(); ctx.arc(hx, hy, leafLen, start, end, ccw); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // static opening labels (only in static mode; live view draws status chips)
  if (opts.openingLabels && cs > 5) {
    ctx.font = `500 ${Math.max(9, cs * 0.62)}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const placed = [];
    for (const g of groups) {
      const [nx, ny] = g.normal || [0, 1];
      const tw = ctx.measureText(g.name).width;
      let lx = ox + g.cx * s + nx * cs * 2.4, ly = oy + g.cy * s + ny * cs * 2.2;
      if (f.cw) lx = Math.max(tw / 2 + 3, Math.min(f.cw - tw / 2 - 3, lx));
      for (let k = 0; k < 4 && placed.some((p) => Math.abs(p.x - lx) < (p.w + tw) / 2 + 6 && Math.abs(p.y - ly) < 12); k++) ly -= 13;
      placed.push({ x: lx, y: ly, w: tw });
      ctx.fillStyle = g.blocked ? C.red : g.type === 'exit' ? C.teal : 'rgba(236,230,218,0.75)';
      ctx.fillText(g.name, lx, ly);
    }
  }

  // dimension lines
  if (opts.dims !== false && compiled.layout.meta.hall && cs > 5) {
    const hb = compiled.layout.meta.hall;
    const L = ox + (hb.x0 - 1) * cs, R = ox + (hb.x1 + 2) * cs;
    const Tp = oy + (hb.y0 - 1) * cs, B = oy + (hb.y1 + 2) * cs;
    const yDim = oy + 0.55 * cs;
    const xDim = ox + 0.55 * cs;
    ctx.strokeStyle = C.dim;
    ctx.fillStyle = C.dim;
    ctx.lineWidth = 1;
    ctx.font = `500 ${Math.max(9, cs * 0.55)}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tick = (x, y) => { ctx.beginPath(); ctx.moveTo(x - 3, y + 3); ctx.lineTo(x + 3, y - 3); ctx.stroke(); };
    // horizontal: interior width
    const iL = ox + hb.x0 * cs, iR = ox + (hb.x1 + 1) * cs;
    ctx.beginPath(); ctx.moveTo(iL, yDim); ctx.lineTo(iR, yDim); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(iL, yDim - 4); ctx.lineTo(iL, Tp + cs); ctx.moveTo(iR, yDim - 4); ctx.lineTo(iR, Tp + cs); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
    tick(iL, yDim); tick(iR, yDim);
    const wTxt = `${((hb.x1 - hb.x0 + 1) * CELL).toFixed(1)} m`;
    const tw = ctx.measureText(wTxt).width + 10;
    ctx.fillStyle = opts.bg || C.bg; ctx.fillRect((iL + iR) / 2 - tw / 2, yDim - 7, tw, 14);
    ctx.fillStyle = C.dim; ctx.fillText(wTxt, (iL + iR) / 2, yDim);
    // vertical: interior depth
    const iT = oy + hb.y0 * cs, iB = oy + (hb.y1 + 1) * cs;
    ctx.beginPath(); ctx.moveTo(xDim, iT); ctx.lineTo(xDim, iB); ctx.stroke();
    tick(xDim, iT); tick(xDim, iB);
    ctx.save();
    ctx.translate(xDim, (iT + iB) / 2);
    ctx.rotate(-Math.PI / 2);
    const hTxt = `${((hb.y1 - hb.y0 + 1) * CELL).toFixed(1)} m`;
    const th = ctx.measureText(hTxt).width + 10;
    ctx.fillStyle = opts.bg || C.bg; ctx.fillRect(-th / 2, -7, th, 14);
    ctx.fillStyle = C.dim; ctx.fillText(hTxt, 0, 0);
    ctx.restore();
    void L; void R; void B;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** density map → small offscreen canvas (one pixel per cell) */
function heatCanvas(compiled, map, cache) {
  const { w, h, passable } = compiled;
  const cv = cache?.cv && cache.cv.width === w && cache.cv.height === h ? cache.cv : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const cx = cv.getContext('2d');
  const img = cache?.img && cache.img.width === w ? cache.img : cx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    if (!passable[i]) { d[i * 4 + 3] = 0; continue; }
    densityRGBA(map[i], d, i * 4);
  }
  cx.putImageData(img, 0, 0);
  if (cache) { cache.cv = cv; cache.img = img; }
  return cv;
}

export function drawHeat(ctx, compiled, map, f, cache) {
  const cv = heatCanvas(compiled, map, cache);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cv, f.ox, f.oy, compiled.w * CELL * f.s, compiled.h * CELL * f.s);
  ctx.restore();
}

/** Render a layout + optional density map to a canvas (reports, before/after, illustrations). */
export function renderStaticPlan(canvas, layout, { map = null, markers = [], pad = 10, dpr = window.devicePixelRatio || 1, labels = true, dims = false, openingLabels = true } = {}) {
  const compiled = compile(layout);
  const geo = planGeometry(compiled);
  const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const f = computeFit(compiled, cw, ch, pad);
  drawUnder(ctx, compiled, geo, f, { labels });
  if (map) drawHeat(ctx, compiled, map, f);
  drawOver(ctx, compiled, geo, f, { dims, openingLabels });
  ctx.font = '600 11px "IBM Plex Mono", monospace';
  markers.forEach((m, k) => drawMarker(ctx, f, m, k, 0));
  return { compiled, f };
}

function drawMarker(ctx, f, b, k, time) {
  const r = Math.max(0.9, Math.sqrt(b.areaM2 / Math.PI) + 0.5) * f.s;
  const x = f.ox + b.x * f.s, y = f.oy + b.y * f.s;
  ctx.save();
  ctx.strokeStyle = '#ff7b72';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.lineDashOffset = -time * 12;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  const label = `B${k + 1}`;
  ctx.font = '600 10.5px "IBM Plex Mono", monospace';
  const tw = ctx.measureText(label).width + 10;
  const lx = x + r * 0.72, ly = y - r * 0.72;
  ctx.fillStyle = '#c93a3a';
  roundRect(ctx, lx - 2, ly - 9, tw, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx + 3, ly);
  ctx.restore();
}

// =============================================================================
// Live renderer bound to the shared controller
// =============================================================================
export class FloorPlan2D {
  constructor(host, controller, opts = {}) {
    this.host = host;
    this.ctl = controller;
    this.opts = { compact: false, interactive: true, ...opts };
    this.layers = { heat: true, flow: false, agents: true, bottlenecks: true, chips: true, grid: true, ...(opts.layers || {}) };
    this.heatMode = 'auto'; // auto | live | peak
    this.editTool = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Floor plan with live crowd simulation');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.under = document.createElement('canvas');
    this.over = document.createElement('canvas');
    this.heatCache = {};
    this.paintBuf = new Set();
    this.hover = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.unsub = controller.subscribe((type) => {
      if (type === 'layout' || type === 'reset') this.rebuild();
      if (type === 'frame') this.draw();
    });
    if (this.opts.interactive) this.bindPointer();
    this.resize();
  }

  destroy() {
    this.unsub();
    this.ro.disconnect();
    hideTip();
    this.canvas.remove();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.rebuild();
  }

  rebuild() {
    if (!this.cw) return;
    const c = this.ctl.sim.c;
    this.compiled = c;
    this.geo = planGeometry(c);
    this.f = computeFit(c, this.cw, this.ch, this.opts.compact ? 8 : 26);
    for (const cv of [this.under, this.over]) { cv.width = this.canvas.width; cv.height = this.canvas.height; }
    const u = this.under.getContext('2d');
    u.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawUnder(u, c, this.geo, this.f, { grid: this.layers.grid, labels: !this.opts.compact });
    const o = this.over.getContext('2d');
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.clearRect(0, 0, this.cw, this.ch);
    drawOver(o, c, this.geo, this.f, { dims: !this.opts.compact, openingLabels: false });
    this.flowCache = null;
    this.draw();
  }

  setLayer(k, v) { this.layers[k] = v; if (k === 'grid') this.rebuild(); else this.draw(); }

  // --------------------------------------------------------------- per frame
  draw() {
    if (!this.f) return;
    const { ctx, dpr } = this;
    const sim = this.ctl.sim;
    const c = sim.c;
    if (c !== this.compiled) { this.rebuild(); return; }
    const alpha = this.ctl.alpha;
    const f = this.f;
    const s = f.s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.under, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // density
    if (this.layers.heat) {
      const mode = this.heatMode === 'auto' ? (sim.done ? 'peak' : 'live') : this.heatMode;
      drawHeat(ctx, c, mode === 'peak' ? sim.peakMap : sim.densityEMA, f, this.heatCache);
    }
    // flow field
    if (this.layers.flow) this.drawFlow(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.over, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // agents
    if (this.layers.agents) this.drawAgents(ctx, alpha);

    // bottlenecks
    const now = performance.now() / 1000;
    if (this.layers.bottlenecks && !sim.done) sim.liveBottlenecks.slice(0, 3).forEach((b, k) => drawMarker(ctx, f, b, k, now));

    if (this.layers.chips && !this.opts.compact) this.drawChips(ctx);

    // highlighted location (risk finding / assistant reference)
    const hl = this.ctl.hl;
    if (hl && hl.x != null) {
      const age = (performance.now() - hl.at) / 1000;
      const x = f.ox + hl.x * s, y = f.oy + hl.y * s, r = Math.max(14, (hl.radius || 1.5) * s);
      const pulse = 1 + 0.08 * Math.sin(age * 5);
      ctx.save();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(111,216,201,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(x, y, r * pulse + 6, 0, Math.PI * 2); ctx.stroke();
      if (hl.label) {
        ctx.setLineDash([]);
        ctx.font = '600 11px "IBM Plex Mono", monospace';
        const tw = ctx.measureText(hl.label).width + 16;
        const lx = Math.min(this.cw - tw - 4, Math.max(4, x - tw / 2)), ly = Math.max(14, y - r - 18);
        ctx.fillStyle = 'rgba(17,19,22,0.92)'; roundRect(ctx, lx, ly - 10, tw, 20, 10); ctx.fill();
        ctx.strokeStyle = 'rgba(111,216,201,0.8)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#ece6da'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(hl.label, lx + 8, ly + 0.5);
      }
      ctx.restore();
    }

    // editor preview
    if (this.paintBuf.size) {
      ctx.fillStyle = 'rgba(47,184,166,0.45)';
      const cs = CELL * s;
      for (const i of this.paintBuf) ctx.fillRect(f.ox + (i % c.w) * cs, f.oy + Math.floor(i / c.w) * cs, cs, cs);
    }
    if (this.hoverCell != null && this.editTool) {
      const cs = CELL * s;
      ctx.strokeStyle = '#2fb8a6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(f.ox + (this.hoverCell % c.w) * cs, f.oy + Math.floor(this.hoverCell / c.w) * cs, cs, cs);
    }

    // alarm strobe
    if (!sim.done && sim.t > 0 && sim.t < 4 && !this.opts.compact) {
      const a = 0.5 + 0.5 * Math.sin(now * 10);
      ctx.strokeStyle = `rgba(224,82,74,${0.25 + 0.45 * a})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, this.cw - 4, this.ch - 4);
    }
    // scale bar + north arrow
    if (!this.opts.compact) this.drawScale(ctx);
  }

  drawAgents(ctx, alpha) {
    const sim = this.ctl.sim;
    const { ox, oy, s } = this.f;
    const N = sim.N;
    const groups = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const ring = new Path2D();
    const ticks = new Path2D();
    for (let i = 0; i < N; i++) {
      const st = sim.state[i];
      if (st === STATE.EVACUATED) continue;
      const x = ox + (sim.px[i] + (sim.x[i] - sim.px[i]) * alpha) * s;
      const y = oy + (sim.py[i] + (sim.y[i] - sim.py[i]) * alpha) * s;
      const r = Math.max(1.6, sim.r[i] * s * 0.92);
      if (st === STATE.WAITING) {
        ring.moveTo(x + r * 0.8, y);
        ring.arc(x, y, r * 0.8, 0, Math.PI * 2);
        continue;
      }
      const k = st === STATE.TRAPPED ? 4 : sim.congested[i] ? 3 : sim.cat[i];
      groups[k].moveTo(x + r, y);
      groups[k].arc(x, y, r, 0, Math.PI * 2);
      const sp = Math.hypot(sim.vx[i], sim.vy[i]);
      if (sp > 0.15 && s > 9) {
        ticks.moveTo(x, y);
        ticks.lineTo(x + (sim.vx[i] / sp) * r * 1.7, y + (sim.vy[i] / sp) * r * 1.7);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = AGENT_COLORS.waiting;
    ctx.stroke(ring);
    const fills = [AGENT_COLORS.adult, AGENT_COLORS.slow, AGENT_COLORS.wheelchair, AGENT_COLORS.congested, '#ff3b30'];
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = fills[k];
      ctx.fill(groups[k]);
    }
    ctx.strokeStyle = 'rgba(17,19,22,0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke(ticks);
  }

  drawFlow(ctx) {
    const sim = this.ctl.sim;
    const c = sim.c;
    const { ox, oy, s } = this.f;
    if (!this.flowCache || this.flowCache.v !== sim.fieldVersion) {
      const p = new Path2D();
      const F = sim.combined;
      const cs = CELL * s;
      for (let y = 1; y < c.h - 1; y += 2)
        for (let x = 1; x < c.w - 1; x += 2) {
          const i = y * c.w + x;
          if (!c.passable[i] || !isFinite(F[i])) continue;
          // best-of-8 descent direction
          let bx = 0, by = 0, best = F[i];
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = (y + dy) * c.w + x + dx;
            if ((dx || dy) && c.passable[j] && F[j] < best) { best = F[j]; bx = dx; by = dy; }
          }
          if (!bx && !by) continue;
          const m = Math.hypot(bx, by);
          const ux = bx / m, uy = by / m;
          const cx = ox + (x + 0.5) * cs, cy = oy + (y + 0.5) * cs;
          const a = cs * 0.55;
          p.moveTo(cx - ux * a - uy * a * 0.55, cy - uy * a + ux * a * 0.55);
          p.lineTo(cx + ux * a * 0.6, cy + uy * a * 0.6);
          p.lineTo(cx - ux * a + uy * a * 0.55, cy - uy * a - ux * a * 0.55);
        }
      this.flowCache = { v: sim.fieldVersion, p };
    }
    ctx.strokeStyle = 'rgba(47,184,166,0.5)';
    ctx.lineWidth = 1.1;
    ctx.stroke(this.flowCache.p);
  }

  drawChips(ctx) {
    const sim = this.ctl.sim;
    const { ox, oy, s } = this.f;
    const cs = CELL * s;
    ctx.font = '500 10.5px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    const placed = [];
    const hits = (x, y, w) => placed.some((p) => x < p.x + p.w + 4 && x + w + 4 > p.x && Math.abs(y - p.y) < 22);
    for (const g of sim.c.groups) {
      const [nx, ny] = g.normal || [0, 1];
      const passed = sim.gatePasses[g.id].length;
      const q = sim.gateQueue[g.id];
      const state = g.blocked ? 'blocked' : q >= 4 ? 'queue' : 'open';
      const txt = g.blocked ? `${g.name} · BLOCKED` : `${g.name} · ${passed}${q > 0 ? ` · q${q}` : ''}`;
      const tw = ctx.measureText(txt).width + 18;
      const off = g.type === 'exit' ? 2.6 : 2.0;
      let lx = ox + g.cx * s + nx * cs * off - (g.horizontal ? tw / 2 : nx < 0 ? tw : 0);
      let ly = oy + g.cy * s + ny * cs * off;
      lx = Math.max(4, Math.min(this.cw - tw - 4, lx));
      ly = Math.max(12, Math.min(this.ch - 12, ly));
      // nudge away from chips already drawn (e.g. a door next to an exit)
      for (let k = 0; k < 6 && hits(lx, ly, tw); k++) ly += ly > this.ch / 2 ? -24 : 24;
      placed.push({ x: lx, y: ly, w: tw });
      ctx.fillStyle = 'rgba(17,19,22,0.88)';
      roundRect(ctx, lx, ly - 10, tw, 20, 10);
      ctx.fill();
      ctx.strokeStyle = state === 'blocked' ? 'rgba(224,82,74,0.8)' : state === 'queue' ? 'rgba(227,160,58,0.8)' : g.type === 'exit' ? 'rgba(47,184,166,0.7)' : 'rgba(236,230,218,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = state === 'blocked' ? C.red : state === 'queue' ? C.amber : C.teal;
      ctx.beginPath(); ctx.arc(lx + 9, ly, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ece6da';
      ctx.textAlign = 'left';
      ctx.fillText(txt, lx + 15, ly + 0.5);
    }
  }

  drawScale(ctx) {
    const s = this.f.s;
    const x0 = 16, y0 = this.ch - 18;
    const len = 5 * s;
    ctx.strokeStyle = 'rgba(236,230,218,0.6)';
    ctx.fillStyle = 'rgba(236,230,218,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0 + len, y0);
    for (let k = 0; k <= 5; k++) { ctx.moveTo(x0 + k * s, y0); ctx.lineTo(x0 + k * s, y0 - (k % 5 === 0 ? 6 : 3)); }
    ctx.stroke();
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', x0 - 2, y0 - 7);
    ctx.fillText('5 m', x0 + len - 6, y0 - 7);
    // north arrow
    const nx = this.cw - 22, ny = 30;
    ctx.beginPath();
    ctx.moveTo(nx, ny - 12); ctx.lineTo(nx + 6, ny + 6); ctx.lineTo(nx, ny + 2); ctx.lineTo(nx - 6, ny + 6); ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillText('N', nx, ny - 14);
  }

  // --------------------------------------------------------------- pointer
  cellAt(ev) {
    const r = this.canvas.getBoundingClientRect();
    const xm = (ev.clientX - r.left - this.f.ox) / this.f.s;
    const ym = (ev.clientY - r.top - this.f.oy) / this.f.s;
    const cx = Math.floor(xm / CELL), cy = Math.floor(ym / CELL);
    const c = this.ctl.sim.c;
    if (cx < 0 || cy < 0 || cx >= c.w || cy >= c.h) return null;
    return { cell: cy * c.w + cx, xm, ym, cx, cy };
  }

  bindPointer() {
    const cv = this.canvas;
    let painting = false;
    cv.addEventListener('pointerdown', (ev) => {
      if (!this.editTool) return;
      const h = this.cellAt(ev);
      if (!h) return;
      painting = true;
      cv.setPointerCapture(ev.pointerId);
      this.paintBuf.add(h.cell);
      this.draw();
    });
    cv.addEventListener('pointermove', (ev) => {
      const h = this.cellAt(ev);
      this.hoverCell = h?.cell ?? null;
      if (this.editTool) {
        hideTip();
        if (painting && h) { this.paintBuf.add(h.cell); }
        this.draw();
        return;
      }
      if (!h) { hideTip(); return; }
      this.showInspector(h, ev);
    });
    const end = () => {
      if (!painting) return;
      painting = false;
      const cells = [...this.paintBuf];
      this.paintBuf.clear();
      this.opts.onPaint?.(cells, this.editTool);
      this.draw();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { hideTip(); this.hoverCell = null; if (this.editTool) this.draw(); });
  }

  showInspector(h, ev) {
    const sim = this.ctl.sim;
    const c = sim.c;
    // nearest agent?
    let best = -1, bd = 0.45;
    for (let i = 0; i < sim.N; i++) {
      if (sim.state[i] === STATE.EVACUATED) continue;
      const d = Math.hypot(sim.x[i] - h.xm, sim.y[i] - h.ym);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const i = best;
      const sp = Math.hypot(sim.vx[i], sim.vy[i]);
      const st = sim.state[i] === STATE.WAITING ? `Reacting (${Math.max(0, sim.react[i] - sim.t).toFixed(1)} s left)` : sim.state[i] === STATE.TRAPPED ? 'No route to an exit' : sim.congested[i] ? 'Queuing / congested' : 'Walking';
      const ex = sim.exitSel[i] >= 0 ? c.groups[sim.exitIds[sim.exitSel[i]]].name : '—';
      showTip(`<div class="t-h">Agent #${i + 1}</div>
        <div class="t-row"><span>Profile</span><span>${CATEGORY[sim.cat[i]]}</span></div>
        <div class="t-row"><span>State</span><span>${st}</span></div>
        <div class="t-row"><span>Speed</span><span>${sp.toFixed(2)} / ${sim.v0[i].toFixed(2)} m/s</span></div>
        <div class="t-row"><span>Target exit</span><span>${esc(ex)}</span></div>
        <div class="t-row"><span>Reaction time</span><span>${sim.react[i].toFixed(1)} s</span></div>`, ev.clientX, ev.clientY);
      return;
    }
    const i = h.cell;
    const t = c.cells[i];
    const names = ['Outside', 'Floor', 'Wall', 'Seat', 'Furniture', 'Door', 'Exit', 'Stage'];
    if (!c.passable[i] && t !== T.DOOR && t !== T.EXIT) {
      showTip(`<div class="t-h">${names[t]}</div><div class="t-row"><span>Grid</span><span>${h.cx}, ${h.cy}</span></div>`, ev.clientX, ev.clientY);
      return;
    }
    const rho = sim.done ? sim.peakMap[i] : sim.densityEMA[i];
    const band = bandOf(rho);
    const dist = sim.combined[i];
    const g = c.groupOf[i] >= 0 ? c.groups[c.groupOf[i]] : null;
    showTip(`<div class="t-h">${g ? esc(g.name) : names[t]} · ${h.xm.toFixed(1)} m, ${h.ym.toFixed(1)} m</div>
      <div class="t-row"><span>${sim.done ? 'Peak density' : 'Density'}</span><span>${rho.toFixed(2)} p/m²</span></div>
      <div class="t-row"><span>Level of service</span><span><i class="sw" style="background:${['#3b9a5c', '#c9a62c', '#e07b2a', '#c93a3a'][band]}"></i>${BAND_LABEL[band]} · LOS ${losFor(rho)}</span></div>
      <div class="t-row"><span>Time ≥ LOS F</span><span>${sim.exposure[i].toFixed(1)} s</span></div>
      <div class="t-row"><span>Route cost to exit</span><span>${isFinite(dist) ? dist.toFixed(1) + ' m-eq' : 'unreachable'}</span></div>
      ${g ? `<div class="t-row"><span>Width · capacity</span><span>${g.widthM.toFixed(1)} m · ${(g.widthM * MODEL.specificFlow).toFixed(2)} p/s</span></div>` : ''}`, ev.clientX, ev.clientY);
  }
}
