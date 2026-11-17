// Interactive vector blueprint editor (Canvas 2D), in the EvacPrint drafting style.
// Shapes are in metres. Supports pan/zoom, snapping, draw tools, selection,
// move/resize handles, 90° rotation, undo/redo, a calibrated background image,
// two-point scale calibration and an "engine grid" overlay that shows exactly
// what the simulator will use.
import { SHAPE_TYPES, ZONE_KINDS, newShape, rectOf, rasterize, M } from './model.js';
import { CELL, T } from '../sim/layout.js';

const COL = { bg: '#111316', paper: '#16191c', grid: 'rgba(236,230,218,0.04)', grid2: 'rgba(236,230,218,0.09)', ink: '#ece6da', wall: '#d4cdc0', teal: '#2fb8a6', amber: '#e3a03a', red: '#e0524a', sel: '#6fd8c9' };
const FILL = {
  room: 'rgba(236,230,218,0.05)', corridor: 'rgba(236,230,218,0.035)', floorplate: 'rgba(236,230,218,0.03)', stairs: 'rgba(127,143,208,0.22)', ramp: 'rgba(127,143,208,0.14)',
  seating: 'rgba(80,88,98,0.55)', chair: '#4a525b', stage: 'rgba(50,56,63,0.9)', furniture: 'rgba(107,90,60,0.7)', pillar: '#d4cdc0', obstacle: 'rgba(227,160,58,0.35)', zone: 'rgba(224,82,74,0.18)',
};

export class BlueprintEditor {
  constructor(host, venue, { onChange, onSelect, onCalibrate, getBackground } = {}) {
    this.host = host;
    this.venue = venue;
    this.cb = { onChange, onSelect, onCalibrate };
    this.getBackground = getBackground;
    this.tool = 'select';
    this.snap = true;
    this.showGrid = false; // engine grid overlay
    this.sel = null;
    this.undo = [];
    this.redo = [];
    this.view = { s: 30, ox: 40, oy: 40 };
    this.cv = document.createElement('canvas');
    this.cv.className = 'bp-canvas';
    this.cv.tabIndex = 0;
    this.cv.setAttribute('aria-label', 'Blueprint editor canvas');
    host.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.bind();
    this.resize();
    this.fit();
  }
  destroy() { this.ro.disconnect(); this.cv.remove(); document.removeEventListener('keydown', this._key); }

  get shapes() { return this.venue.plan.shapes; }
  resize() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 2) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
    this.cv.style.width = `${r.width}px`; this.cv.style.height = `${r.height}px`;
    if (!this.userMoved) this.fit(); else this.draw();
  }
  fit() {
    if (!this.W) return;
    const { width, height } = this.venue.plan;
    const s = Math.min((this.W - 60) / width, (this.H - 60) / height);
    this.view = { s, ox: (this.W - width * s) / 2, oy: (this.H - height * s) / 2 };
    this.draw();
  }
  toM(px, py) { return [(px - this.view.ox) / this.view.s, (py - this.view.oy) / this.view.s]; }
  toPx(x, y) { return [this.view.ox + x * this.view.s, this.view.oy + y * this.view.s]; }
  snapV(v) { return this.snap ? Math.round(v / 0.25) * 0.25 : Math.round(v * 100) / 100; }

  // ---------------------------------------------------------------- history
  // undo states hold the shapes and the plan extent (a generated room can change both)
  snapshot() { const p = this.venue.plan; return JSON.stringify({ shapes: p.shapes, width: p.width, height: p.height }); }
  restore(json) { const p = this.venue.plan, st = JSON.parse(json); p.shapes = st.shapes; p.width = st.width; p.height = st.height; this.sel = null; this.cb.onExtent?.(); this.changed(); }
  checkpoint() { this.undo.push(this.snapshot()); if (this.undo.length > 120) this.undo.shift(); this.redo = []; }
  doUndo() { if (!this.undo.length) return; this.redo.push(this.snapshot()); this.restore(this.undo.pop()); }
  doRedo() { if (!this.redo.length) return; this.undo.push(this.snapshot()); this.restore(this.redo.pop()); }
  changed(selOnly = false) { this.grid = null; this.draw(); if (!selOnly) this.cb.onChange?.(); this.cb.onSelect?.(this.selected()); }
  selected() { return this.shapes.find((s) => s.id === this.sel) || null; }
  select(id) { this.sel = id; this.changed(true); }
  update(id, patch, record = true) { const s = this.shapes.find((q) => q.id === id); if (!s) return; if (record) this.checkpoint(); Object.assign(s, patch); this.changed(); }
  remove(id) { this.checkpoint(); this.venue.plan.shapes = this.shapes.filter((s) => s.id !== id); this.sel = null; this.changed(); }
  duplicate(id) {
    const s = this.shapes.find((q) => q.id === id); if (!s) return;
    this.checkpoint();
    const c = JSON.parse(JSON.stringify(s));
    c.id = newShape(s.type, 0, 0).id; c.name = s.name ? `${s.name} copy` : '';
    if (c.x1 != null) { c.x1 += 1; c.x2 += 1; c.y1 += 1; c.y2 += 1; } else { c.x += 1; c.y += 1; }
    this.shapes.push(c); this.sel = c.id; this.changed();
  }
  rotate(id) {
    const s = this.shapes.find((q) => q.id === id); if (!s) return;
    this.checkpoint();
    if (s.x1 != null) { const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2; const r = (x, y) => [cx - (y - cy), cy + (x - cx)]; [s.x1, s.y1] = r(s.x1, s.y1); [s.x2, s.y2] = r(s.x2, s.y2); }
    else s.rot = ((s.rot || 0) + 90) % 360;
    this.changed();
  }
  addShapes(list) { this.checkpoint(); for (const s of list) this.shapes.push({ ...newShape(s.type, 0, 0), ...s }); this.changed(); }

  // ---------------------------------------------------------------- hit testing
  hit(x, y) {
    const tol = 6 / this.view.s;
    for (let k = this.shapes.length - 1; k >= 0; k--) {
      const s = this.shapes[k];
      if (s.x1 != null) {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / L));
        if (Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy)) < tol + 0.15) return s;
      } else if (s.width != null) {
        const hz = s.rot % 180 === 0;
        const x0 = s.x, y0 = s.y, x1 = hz ? s.x + s.width : s.x + CELL, y1 = hz ? s.y + CELL : s.y + s.width;
        if (x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol) return s;
      }
    }
    // rects: smallest containing first (so furniture inside rooms is selectable)
    const rects = this.shapes.filter((s) => s.w != null).map((s) => ({ s, r: rectOf(s) })).filter(({ r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    rects.sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h);
    return rects[0]?.s || null;
  }
  handles(s) {
    if (!s) return [];
    if (s.x1 != null) return [{ k: 'p1', x: s.x1, y: s.y1 }, { k: 'p2', x: s.x2, y: s.y2 }];
    if (s.w != null) { const r = rectOf(s); return [{ k: 'se', x: r.x + r.w, y: r.y + r.h }, { k: 'nw', x: r.x, y: r.y }, { k: 'ne', x: r.x + r.w, y: r.y }, { k: 'sw', x: r.x, y: r.y + r.h }]; }
    return [];
  }

  // ---------------------------------------------------------------- pointer
  bind() {
    const cv = this.cv;
    let drag = null;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const [mx, my] = this.toM(e.clientX - r.left, e.clientY - r.top);
      const k = Math.exp(-e.deltaY * 0.0015);
      this.userMoved = true;
      this.view.s = Math.max(4, Math.min(220, this.view.s * k));
      this.view.ox = e.clientX - r.left - mx * this.view.s;
      this.view.oy = e.clientY - r.top - my * this.view.s;
      this.draw();
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.focus();
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const [x, y] = this.toM(px, py);
      cv.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || this.tool === 'pan' || this.spaceDown) { drag = { mode: 'pan', px, py, ox: this.view.ox, oy: this.view.oy }; this.userMoved = true; return; }
      if (this.tool === 'calibrate') {
        this.calib = this.calib && this.calib.length === 1 ? [...this.calib, [x, y]] : [[x, y]];
        if (this.calib.length === 2) this.cb.onCalibrate?.(this.calib);
        this.draw();
        return;
      }
      if (this.tool === 'select') {
        const s = this.selected();
        const hd = this.handles(s).find((h) => Math.hypot(h.x - x, h.y - y) < 8 / this.view.s);
        if (hd) { this.checkpoint(); drag = { mode: 'handle', k: hd.k, s }; return; }
        const hitS = this.hit(x, y);
        this.sel = hitS?.id || null;
        if (hitS) { this.checkpoint(); drag = { mode: 'move', s: hitS, x, y, orig: JSON.parse(JSON.stringify(hitS)), moved: false }; }
        this.changed(true);
        return;
      }
      const def = SHAPE_TYPES[this.tool];
      if (!def) return;
      const sx = this.snapV(x), sy = this.snapV(y);
      this.checkpoint();
      if (def.kind === 'opening' || this.tool === 'chair' || this.tool === 'pillar') {
        const s = newShape(this.tool, sx, sy);
        if (def.kind === 'opening') this.orientOpening(s);
        this.shapes.push(s);
        this.sel = s.id;
        this.changed();
        return;
      }
      const s = newShape(this.tool, sx, sy);
      if (def.kind === 'line') { s.x2 = sx; s.y2 = sy; } else { s.w = 0; s.h = 0; }
      this.shapes.push(s);
      this.sel = s.id;
      drag = { mode: 'create', s, x0: sx, y0: sy };
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const [x, y] = this.toM(px, py);
      this.cursor = [x, y];
      if (!drag) { this.drawSoon(); return; }
      if (drag.mode === 'pan') { this.view.ox = drag.ox + (px - drag.px); this.view.oy = drag.oy + (py - drag.py); this.draw(); return; }
      const sx = this.snapV(x), sy = this.snapV(y);
      const s = drag.s;
      if (drag.mode === 'create') {
        if (s.x1 != null) {
          // walls snap to horizontal/vertical when close (shift = free)
          let ex = sx, ey = sy;
          if (!e.shiftKey) { if (Math.abs(ex - s.x1) < Math.abs(ey - s.y1) * 0.25) ex = s.x1; else if (Math.abs(ey - s.y1) < Math.abs(ex - s.x1) * 0.25) ey = s.y1; }
          s.x2 = ex; s.y2 = ey;
        } else {
          s.x = Math.min(drag.x0, sx); s.y = Math.min(drag.y0, sy); s.w = Math.abs(sx - drag.x0); s.h = Math.abs(sy - drag.y0);
        }
      } else if (drag.mode === 'move') {
        const dx = this.snapV(x - drag.x), dy = this.snapV(y - drag.y);
        const o = drag.orig;
        if (o.x1 != null) Object.assign(s, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
        else Object.assign(s, { x: o.x + dx, y: o.y + dy });
        drag.moved = drag.moved || dx || dy;
      } else if (drag.mode === 'handle') {
        if (drag.k === 'p1') Object.assign(s, { x1: sx, y1: sy });
        else if (drag.k === 'p2') Object.assign(s, { x2: sx, y2: sy });
        else {
          const rr = rectOf(s);
          let x0 = rr.x, y0 = rr.y, x1 = rr.x + rr.w, y1 = rr.y + rr.h;
          if (drag.k.includes('e')) x1 = Math.max(x0 + 0.5, sx); if (drag.k.includes('w')) x0 = Math.min(x1 - 0.5, sx);
          if (drag.k.includes('s')) y1 = Math.max(y0 + 0.5, sy); if (drag.k.includes('n')) y0 = Math.min(y1 - 0.5, sy);
          const nw = x1 - x0, nh = y1 - y0;
          const swap = s.rot % 180 !== 0;
          s.w = swap ? nh : nw; s.h = swap ? nw : nh;
          s.x = (x0 + x1) / 2 - s.w / 2; s.y = (y0 + y1) / 2 - s.h / 2;
        }
      }
      this.grid = null;
      this.draw();
      this.cb.onSelect?.(s);
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.mode === 'create') {
        const s = d.s;
        const tiny = s.x1 != null ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 0.4 : s.w < 0.4 || s.h < 0.4;
        if (tiny) {
          // a click without dragging places a default-size shape
          if (s.x1 != null) { s.x2 = s.x1 + 4; s.y2 = s.y1; } else { const def = SHAPE_TYPES[s.type]; s.w = def.w; s.h = def.h; }
        }
        this.tool = this.sticky ? this.tool : 'select';
        this.cb.onTool?.(this.tool);
        this.changed();
      } else if (d.mode === 'move') { if (d.moved) this.changed(); else this.undo.pop(); }
      else if (d.mode === 'handle') this.changed();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    this._key = (e) => {
      if (!this.cv.isConnected) return;
      if (e.target.closest('input, textarea, select')) return;
      if (e.code === 'Space') { this.spaceDown = e.type === 'keydown'; if (document.activeElement === this.cv) e.preventDefault(); return; }
      if (e.type !== 'keydown') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.doRedo() : this.doUndo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.doRedo(); }
      else if (mod && e.key.toLowerCase() === 'd' && this.sel) { e.preventDefault(); this.duplicate(this.sel); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && document.activeElement === this.cv) { e.preventDefault(); this.remove(this.sel); }
      else if (e.key === 'r' && this.sel && document.activeElement === this.cv) this.rotate(this.sel);
      else if (e.key === 'Escape') { this.tool = 'select'; this.cb.onTool?.('select'); this.sel = null; this.calib = null; this.changed(true); }
      else if (this.sel && document.activeElement === this.cv && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const s = this.selected(); const d = e.shiftKey ? 1 : 0.25;
        const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
        this.checkpoint();
        if (s.x1 != null) { s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; } else { s.x += dx; s.y += dy; }
        this.changed();
      }
    };
    document.addEventListener('keydown', this._key);
    document.addEventListener('keyup', this._key);
  }

  /** orient a new door/exit along the nearest wall line */
  orientOpening(s) {
    const L = rasterize(this.venue);
    const cx = Math.floor(s.x / CELL) + M, cy = Math.floor(s.y / CELL) + M;
    let best = null;
    for (let r = 0; r <= 4 && !best; r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= L.w - 1 || y >= L.h - 1) continue;
        if (L.cells[y * L.w + x] !== T.WALL) continue;
        const hz = L.cells[y * L.w + x - 1] === T.WALL || L.cells[y * L.w + x + 1] === T.WALL;
        if (!best || Math.abs(dx) + Math.abs(dy) < best.d) best = { x, y, hz, d: Math.abs(dx) + Math.abs(dy) };
      }
    if (best) {
      s.rot = best.hz ? 0 : 90;
      const k = Math.round(s.width / CELL);
      s.x = (best.x - M - (best.hz ? Math.floor(k / 2) : 0)) * CELL;
      s.y = (best.y - M - (best.hz ? 0 : Math.floor(k / 2))) * CELL;
    }
  }

  // ---------------------------------------------------------------- drawing
  drawSoon() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); }); }
  draw() {
    if (!this.W) return;
    const { ctx, dpr, view } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, this.W, this.H);
    const { width, height } = this.venue.plan;
    const [px0, py0] = this.toPx(0, 0);
    ctx.fillStyle = COL.paper; ctx.fillRect(px0, py0, width * view.s, height * view.s);
    // background image
    const bg = this.getBackground?.();
    const meta = this.venue.plan.background;
    if (bg && meta) {
      ctx.save();
      ctx.globalAlpha = meta.opacity ?? 0.55;
      const [bx, by] = this.toPx(meta.x || 0, meta.y || 0);
      ctx.drawImage(bg, bx, by, bg.width * meta.mPerPx * view.s, bg.height * meta.mPerPx * view.s);
      ctx.restore();
    }
    // grid 0.5 m / 1 m / 5 m
    if (view.s * CELL > 5) {
      for (let x = 0; x <= width + 1e-6; x += CELL) { const [gx] = this.toPx(x, 0); ctx.strokeStyle = Math.abs(x % 5) < 1e-6 ? COL.grid2 : COL.grid; ctx.beginPath(); ctx.moveTo(Math.round(gx) + 0.5, py0); ctx.lineTo(Math.round(gx) + 0.5, py0 + height * view.s); ctx.stroke(); }
      for (let y = 0; y <= height + 1e-6; y += CELL) { const [, gy] = this.toPx(0, y); ctx.strokeStyle = Math.abs(y % 5) < 1e-6 ? COL.grid2 : COL.grid; ctx.beginPath(); ctx.moveTo(px0, Math.round(gy) + 0.5); ctx.lineTo(px0 + width * view.s, Math.round(gy) + 0.5); ctx.stroke(); }
    }
    // engine-grid overlay
    if (this.showGrid) {
      if (!this.grid) this.grid = rasterize(this.venue);
      const L = this.grid;
      const cs = CELL * view.s;
      const col = { [T.FLOOR]: 'rgba(47,184,166,0.10)', [T.WALL]: 'rgba(236,230,218,0.75)', [T.SEAT]: 'rgba(120,128,138,0.8)', [T.OBST]: 'rgba(227,160,58,0.6)', [T.DOOR]: 'rgba(240,189,108,0.9)', [T.EXIT]: 'rgba(47,184,166,0.95)', [T.STAGE]: 'rgba(80,86,94,0.9)' };
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) { const t = L.cells[y * L.w + x]; if (!t) continue; const [gx, gy] = this.toPx((x - M) * CELL, (y - M) * CELL); ctx.fillStyle = col[t]; ctx.fillRect(gx, gy, cs - 0.5, cs - 0.5); }
      for (const z of L.meta.hazards) { ctx.fillStyle = 'rgba(224,82,74,0.55)'; for (const c of z.cells) { const [gx, gy] = this.toPx(((c % L.w) - M) * CELL, (Math.floor(c / L.w) - M) * CELL); ctx.fillRect(gx, gy, cs - 0.5, cs - 0.5); } }
    }
    // shapes: areas first, then contents, then lines, then openings
    const order = ['floorplate', 'room', 'corridor', 'stairs', 'ramp', 'stage', 'seating', 'zone', 'furniture', 'obstacle', 'chair', 'pillar'];
    const rects = this.shapes.filter((s) => s.w != null).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    ctx.lineJoin = 'miter';
    for (const s of rects) {
      const r = rectOf(s);
      const [x, y] = this.toPx(r.x, r.y);
      const w = r.w * view.s, h = r.h * view.s;
      if (!this.showGrid) { ctx.fillStyle = s.type === 'zone' && ZONE_KINDS[s.kind] && !ZONE_KINDS[s.kind].blocks ? 'rgba(127,143,208,0.2)' : FILL[s.type] || 'rgba(255,255,255,0.05)'; ctx.fillRect(x, y, w, h); }
      ctx.lineWidth = s.type === 'room' || s.type === 'corridor' ? Math.max(2, view.s * 0.2) : 1;
      ctx.strokeStyle = s.type === 'room' || s.type === 'corridor' ? COL.wall : s.type === 'zone' ? COL.red : s.type === 'floorplate' ? 'rgba(236,230,218,0.25)' : 'rgba(236,230,218,0.4)';
      if (s.type === 'zone' || s.type === 'floorplate') ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      if (s.type === 'seating' && !this.showGrid) {
        const vert = s.rot % 180 !== 0;
        const pitch = (s.pitch || 1) * view.s;
        ctx.strokeStyle = 'rgba(236,230,218,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath();
        if (!vert) for (let yy = y + pitch * 0.5; yy < y + h; yy += pitch) { ctx.moveTo(x + 2, yy); ctx.lineTo(x + w - 2, yy); }
        else for (let xx = x + pitch * 0.5; xx < x + w; xx += pitch) { ctx.moveTo(xx, y + 2); ctx.lineTo(xx, y + h - 2); }
        ctx.stroke();
        // facing arrow
        const ang = { 0: -Math.PI / 2, 90: 0, 180: Math.PI / 2, 270: Math.PI }[s.rot || 0];
        this.arrow(x + w / 2, y + h / 2, ang, Math.min(w, h) * 0.25, 'rgba(111,216,201,0.8)');
      }
      if (s.type === 'stairs' || s.type === 'ramp') {
        ctx.strokeStyle = 'rgba(160,172,230,0.6)'; ctx.lineWidth = 1; ctx.beginPath();
        const along = r.h >= r.w;
        const step = (s.type === 'stairs' ? 0.3 : 0.6) * view.s;
        if (along) for (let yy = y + step; yy < y + h; yy += step) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
        else for (let xx = x + step; xx < x + w; xx += step) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
        ctx.stroke();
      }
      const label = s.name || (s.type === 'zone' ? ZONE_KINDS[s.kind]?.label.split(' (')[0] : ['room', 'corridor', 'stage', 'stairs', 'ramp', 'floorplate'].includes(s.type) ? SHAPE_TYPES[s.type].label : '');
      if (label && w > 40 && h > 16) this.text(label.toUpperCase(), x + 6, y + 13, s.type === 'zone' ? COL.red : 'rgba(236,230,218,0.55)', 10);
    }
    for (const s of this.shapes.filter((q) => q.x1 != null)) {
      const [a, b] = this.toPx(s.x1, s.y1), [c, d] = this.toPx(s.x2, s.y2);
      ctx.strokeStyle = COL.wall; ctx.lineWidth = Math.max(2, view.s * 0.2); ctx.lineCap = 'square';
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
    for (const s of this.shapes.filter((q) => q.width != null)) {
      const hz = s.rot % 180 === 0;
      const [x, y] = this.toPx(s.x, s.y);
      const L = s.width * view.s, t = CELL * view.s;
      const col = s.type === 'exit' ? COL.teal : COL.amber;
      ctx.fillStyle = col; ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y, hz ? L : t, hz ? t : L);
      ctx.globalAlpha = 1;
      const blocked = this.venue.config.exits?.[s.name]?.open === false;
      if (blocked) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (hz ? L : t), y + (hz ? t : L)); ctx.stroke(); }
      this.text(s.name || '', hz ? x + L / 2 : x + t + 4, hz ? y - 5 : y + L / 2, col, 10, hz ? 'center' : 'left');
    }
    // selection
    const sel = this.selected();
    if (sel) {
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
      if (sel.x1 != null) { const [a, b] = this.toPx(sel.x1, sel.y1), [c, d] = this.toPx(sel.x2, sel.y2); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
      else if (sel.w != null) { const r = rectOf(sel); const [x, y] = this.toPx(r.x, r.y); ctx.strokeRect(x - 2, y - 2, r.w * view.s + 4, r.h * view.s + 4); }
      else { const hz = sel.rot % 180 === 0; const [x, y] = this.toPx(sel.x, sel.y); ctx.strokeRect(x - 3, y - 3, (hz ? sel.width : CELL) * view.s + 6, (hz ? CELL : sel.width) * view.s + 6); }
      ctx.setLineDash([]);
      for (const hd of this.handles(sel)) { const [x, y] = this.toPx(hd.x, hd.y); ctx.fillStyle = '#fff'; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeStyle = COL.teal; ctx.strokeRect(x - 4, y - 4, 8, 8); }
      // dimension readout
      const dim = sel.x1 != null ? `${Math.hypot(sel.x2 - sel.x1, sel.y2 - sel.y1).toFixed(2)} m` : sel.w != null ? `${rectOf(sel).w.toFixed(2)} × ${rectOf(sel).h.toFixed(2)} m` : `${sel.width.toFixed(2)} m`;
      this.pill(dim, 14, this.H - 18);
    }
    // calibration
    if (this.calib) {
      ctx.strokeStyle = COL.amber; ctx.fillStyle = COL.amber; ctx.lineWidth = 2;
      const pts = this.calib.map(([x, y]) => this.toPx(x, y));
      if (pts.length === 2) { ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.stroke(); }
      for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
    }
    // cursor readout
    if (this.cursor) this.pill(`${this.cursor[0].toFixed(2)} m, ${this.cursor[1].toFixed(2)} m · ${this.tool}`, this.W - 14, this.H - 18, 'right');
    // scale bar
    ctx.strokeStyle = 'rgba(236,230,218,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(14, 18); ctx.lineTo(14 + 5 * view.s, 18); ctx.moveTo(14, 14); ctx.lineTo(14, 22); ctx.moveTo(14 + 5 * view.s, 14); ctx.lineTo(14 + 5 * view.s, 22); ctx.stroke();
    this.text('5 m', 18 + 5 * view.s, 21, 'rgba(236,230,218,0.6)', 10);
  }
  arrow(x, y, a, len, col) {
    const { ctx } = this;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    ctx.moveTo(x - Math.cos(a) * len * 0.4, y - Math.sin(a) * len * 0.4); ctx.lineTo(ex, ey);
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a - 0.5) * 8, ey - Math.sin(a - 0.5) * 8);
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a + 0.5) * 8, ey - Math.sin(a + 0.5) * 8);
    ctx.stroke();
  }
  text(t, x, y, col, size = 11, align = 'left') { const { ctx } = this; ctx.font = `500 ${size}px "IBM Plex Mono", monospace`; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y); }
  pill(t, x, y, align = 'left') {
    const { ctx } = this;
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    const w = ctx.measureText(t).width + 14;
    const x0 = align === 'right' ? x - w : x;
    ctx.fillStyle = 'rgba(17,19,22,0.9)'; ctx.beginPath(); ctx.roundRect(x0, y - 10, w, 20, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(236,230,218,0.2)'; ctx.stroke();
    this.text(t, x0 + 7, y, '#ece6da', 11);
  }
}
