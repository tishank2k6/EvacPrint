// Isometric (2.5D) renderer of a compiled layout.
// The floor plane is an affine image of the 2D plan, so the floor drafting
// layer and the live density field are drawn with a single setTransform.
// Walls are extruded prisms; agents are small figures at their real positions.
import { CELL, T } from '../sim/layout.js';
import { STATE } from '../sim/engine.js';
import { planGeometry, drawUnder } from './floorplan.js';
import { densityRGBA } from './colors.js';

const C30 = Math.cos(Math.PI / 6), S30 = Math.sin(Math.PI / 6);

export function wallRects(compiled) {
  const { w, h, cells } = compiled;
  const seen = new Uint8Array(w * h);
  const out = [];
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
      out.push({ x0: x * CELL, z0: y * CELL, x1: (x1 + 1) * CELL, z1: (y1 + 1) * CELL });
    }
  // painter's order: far (small x+z) first
  out.sort((a, b) => a.x1 + a.z1 - (b.x1 + b.z1));
  return out;
}

export function isoFit(compiled, cw, ch, pad = 20, wallH = 1.2) {
  const W = compiled.w * CELL, H = compiled.h * CELL;
  // projected extent
  const spanX = (W + H) * C30;
  const spanY = (W + H) * S30 + wallH;
  const k = Math.min((cw - 2 * pad) / spanX, (ch - 2 * pad) / spanY);
  const ox = cw / 2 - ((W - H) * C30 * k) / 2;
  const oy = (ch - ((W + H) * S30 - wallH) * k) / 2 + wallH * k * 0.5;
  const P = (X, Z, Y = 0) => [ox + (X - Z) * C30 * k, oy + (X + Z) * S30 * k - Y * k];
  return { k, ox, oy, P, W, H, wallH };
}

function prism(ctx, P, r, hgt, top, left, right, edge) {
  const a = P(r.x0, r.z1), b = P(r.x1, r.z1), c = P(r.x1, r.z0);
  const at = P(r.x0, r.z1, hgt), bt = P(r.x1, r.z1, hgt), ct = P(r.x1, r.z0, hgt), dt = P(r.x0, r.z0, hgt);
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...bt); ctx.lineTo(...at); ctx.closePath();
  ctx.fillStyle = left; ctx.fill(); if (edge) { ctx.strokeStyle = edge; ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(...b); ctx.lineTo(...c); ctx.lineTo(...ct); ctx.lineTo(...bt); ctx.closePath();
  ctx.fillStyle = right; ctx.fill(); if (edge) ctx.stroke();
  ctx.beginPath(); ctx.moveTo(...at); ctx.lineTo(...bt); ctx.lineTo(...ct); ctx.lineTo(...dt); ctx.closePath();
  ctx.fillStyle = top; ctx.fill(); if (edge) ctx.stroke();
}

/** Live isometric canvas bound to a source { sim, alpha, subscribe } */
export class IsoLive {
  constructor(host, source, opts = {}) {
    this.host = host;
    this.src = source;
    this.opts = { wallH: 1.15, glass: 0.82, ...opts };
    this.cv = document.createElement('canvas');
    this.cv.className = 'iso-canvas';
    host.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.unsub = source.subscribe((t) => { if (t === 'frame') this.draw(); if (t === 'layout' || t === 'reset') this.rebuild(); });
    this.resize();
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 2) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = r.width; this.ch = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    this.cv.style.width = `${r.width}px`;
    this.cv.style.height = `${r.height}px`;
    this.rebuild();
  }
  rebuild() {
    const c = (this.compiled = this.src.sim.c);
    if (!this.cw) return;
    this.f = isoFit(c, this.cw, this.ch, this.opts.pad ?? 16, this.opts.wallH);
    // flat floor texture
    const ppm = 20;
    const fc = (this.floor = document.createElement('canvas'));
    fc.width = Math.round(this.f.W * ppm); fc.height = Math.round(this.f.H * ppm);
    drawUnder(fc.getContext('2d'), c, planGeometry(c), { s: ppm, ox: 0, oy: 0 }, { bg: 'rgba(0,0,0,0)', labels: false, grid: true });
    this.ppm = ppm;
    // walls layer
    const wl = (this.walls = document.createElement('canvas'));
    wl.width = this.cv.width; wl.height = this.cv.height;
    const wx = wl.getContext('2d');
    wx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    wx.lineWidth = 0.6;
    const g = this.opts.glass;
    for (const r of wallRects(c)) prism(wx, this.f.P, r, this.f.wallH, `rgba(236,230,218,${g})`, `rgba(150,145,136,${g * 0.75})`, `rgba(190,184,173,${g * 0.75})`, 'rgba(15,17,19,0.35)');
    // openings markers (teal thresholds for exits)
    for (const gr of c.groups) {
      const [sx, sy] = this.f.P(gr.cx, gr.cy, this.f.wallH + 0.35);
      wx.fillStyle = gr.blocked ? '#e0524a' : gr.type === 'exit' ? '#2fb8a6' : 'rgba(236,230,218,0.7)';
      wx.beginPath(); wx.arc(sx, sy, gr.type === 'exit' ? 3.2 : 2.2, 0, Math.PI * 2); wx.fill();
    }
    this.heatCv = document.createElement('canvas');
    this.heatCv.width = c.w; this.heatCv.height = c.h;
    this.heatImg = this.heatCv.getContext('2d').createImageData(c.w, c.h);
    this.draw();
  }
  draw() {
    if (!this.f) return;
    const sim = this.src.sim;
    if (sim.c !== this.compiled) { this.rebuild(); return; }
    const { ctx, dpr, f } = this;
    const k = f.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    // floor (affine)
    const s = 1 / this.ppm;
    ctx.setTransform(dpr * C30 * k * s, dpr * S30 * k * s, -dpr * C30 * k * s, dpr * S30 * k * s, dpr * f.ox, dpr * f.oy);
    ctx.drawImage(this.floor, 0, 0);
    // density (affine, smoothed)
    const { w, h, passable } = this.compiled;
    const d = this.heatImg.data;
    const map = sim.done ? sim.peakMap : sim.densityEMA;
    for (let i = 0; i < w * h; i++) { if (!passable[i]) { d[i * 4 + 3] = 0; continue; } densityRGBA(map[i], d, i * 4, this.opts.heatAlpha ?? 1); }
    this.heatCv.getContext('2d').putImageData(this.heatImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(dpr * C30 * k * CELL, dpr * S30 * k * CELL, -dpr * C30 * k * CELL, dpr * S30 * k * CELL, dpr * f.ox, dpr * f.oy);
    ctx.drawImage(this.heatCv, 0, 0);
    // agents, depth sorted
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = this.src.alpha ?? 1;
    const order = [];
    for (let i = 0; i < sim.N; i++) if (sim.state[i] !== STATE.EVACUATED) order.push(i);
    order.sort((i, j) => sim.x[i] + sim.y[i] - (sim.x[j] + sim.y[j]));
    const hgt = 1.45 * k;
    const rad = Math.max(1.4, 0.2 * k);
    for (const i of order) {
      const x = sim.px[i] + (sim.x[i] - sim.px[i]) * a;
      const y = sim.py[i] + (sim.y[i] - sim.py[i]) * a;
      const [sx, sy] = f.P(x, y);
      const st = sim.state[i];
      const col = st === STATE.WAITING ? '#8a857c' : sim.congested[i] ? '#f06d64' : sim.cat[i] === 1 ? '#e3a03a' : sim.cat[i] === 2 ? '#8b9be0' : '#ece6da';
      const hh = st === STATE.WAITING && sim.seated[i] ? hgt * 0.62 : hgt;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(sx, sy, rad * 1.2, rad * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = rad * 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy - rad * 0.6); ctx.lineTo(sx, sy - hh + rad * 2.2); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(sx, sy - hh + rad * 0.6, rad * 0.85, 0, Math.PI * 2); ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.walls, 0, 0);
  }
  destroy() { this.unsub(); this.ro.disconnect(); this.cv.remove(); }
}

/** Minimal self-driving source: runs a private Simulation in real time and loops. */
export class LoopDriver {
  constructor(makeSim, { speed = 1.6, holdEnd = 3 } = {}) {
    this.makeSim = makeSim;
    this.sim = makeSim();
    this.speed = speed;
    this.holdEnd = holdEnd;
    this.alpha = 1;
    this.listeners = new Set();
    this.acc = 0;
    this.hold = 0;
    this.visible = true;
    this.paused = false;
    this._tick = this._tick.bind(this);
    this.raf = 0;
  }
  subscribe(fn) { this.listeners.add(fn); if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this._tick); } return () => this.listeners.delete(fn); }
  emit(t) { for (const fn of this.listeners) fn(t); }
  get phase() { return this.sim.done ? 'Complete' : this.sim.t < 3 ? 'Alarm' : 'Evacuating'; }
  _tick(now) {
    this.raf = 0;
    if (!this.listeners.size) return;
    const real = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.visible && !this.paused) {
      if (this.sim.done) {
        this.hold += real;
        if (this.hold > this.holdEnd) { this.sim = this.makeSim(); this.hold = 0; this.acc = 0; this.emit('reset'); }
      } else {
        this.acc += real * this.speed;
        let n = 0;
        while (this.acc >= this.sim.dt && n < 20) { this.sim.step(); this.acc -= this.sim.dt; n++; }
        this.alpha = Math.min(1, this.acc / this.sim.dt);
      }
      this.emit('frame');
    }
    this.raf = requestAnimationFrame(this._tick);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.listeners.clear(); }
}
