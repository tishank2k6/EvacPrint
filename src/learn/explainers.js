// "Understand the Science Behind EvacPrint" — eight animated explainers.
// Simulation-based explainers replay real engine runs recorded on open, so
// every number on screen is measured, and the timeline is scrubbable.
import { miniRoom, recordRun, frameAt, compile } from './mini.js';
import { planGeometry, drawUnder, drawOver, computeFit } from '../render/floorplan.js';
import { densityRGBA, BAND } from '../render/colors.js';
import { dijkstraTrace } from '../sim/pathfinding.js';
import { weidmannFactor, losFor } from '../sim/engine.js';
import { CELL } from '../sim/layout.js';
import { createHall406 } from '../sim/layout.js';

const MONO = '"IBM Plex Mono", monospace';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => 1 - Math.pow(1 - clamp01(v), 3);

function label(ctx, text, x, y, { size = 12, color = '#ece6da', font = MONO, align = 'left', weight = 500, bg = null } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (bg) {
    const w = ctx.measureText(text).width + 14;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x - 7;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x0, y - size * 0.95, w, size * 1.9, 6);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Plan + density + agents view for a recorded run. */
class MiniView {
  constructor(rec) { this.rec = rec; this.c = rec.compiled; this.geo = planGeometry(this.c); this.key = ''; }
  layers(w, h, pad) {
    const key = `${w}x${h}x${pad}`;
    if (key === this.key) return;
    this.key = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.f = computeFit(this.c, w, h, pad);
    const mk = () => Object.assign(document.createElement('canvas'), { width: Math.round(w * dpr), height: Math.round(h * dpr) });
    this.under = mk(); this.over = mk();
    const u = this.under.getContext('2d'); u.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawUnder(u, this.c, this.geo, this.f, { labels: false, bg: '#111316' });
    const o = this.over.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOver(o, this.c, this.geo, this.f, { dims: false, openingLabels: false });
    this.heat = Object.assign(document.createElement('canvas'), { width: this.c.w, height: this.c.h });
    this.img = this.heat.getContext('2d').createImageData(this.c.w, this.c.h);
  }
  draw(ctx, x, y, w, h, frame, { heat = true, pad = 8, highlight = [] } = {}) {
    this.layers(w, h, pad);
    ctx.save();
    ctx.translate(x, y);
    ctx.drawImage(this.under, 0, 0, w, h);
    const f = this.f;
    if (heat) {
      const d = this.img.data, { passable } = this.c;
      for (let i = 0; i < passable.length; i++) { if (!passable[i]) { d[i * 4 + 3] = 0; continue; } densityRGBA(frame.heat[i], d, i * 4); }
      this.heat.getContext('2d').putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.heat, f.ox, f.oy, this.c.w * CELL * f.s, this.c.h * CELL * f.s);
    }
    ctx.drawImage(this.over, 0, 0, w, h);
    const cols = ['rgba(236,230,218,0.45)', '#ece6da', '#f06d64'];
    const catCol = ['#ece6da', '#e3a03a', '#8b9be0'];
    for (let i = 0; i < this.rec.N; i++) {
      const st = frame.st[i];
      if (st === 3) continue;
      const px = f.ox + frame.xs[i] * f.s, py = f.oy + frame.ys[i] * f.s;
      const r = Math.max(1.8, this.rec.r[i] * f.s * 0.92);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (st === 0) { ctx.strokeStyle = cols[0]; ctx.lineWidth = 1.2; ctx.stroke(); }
      else { ctx.fillStyle = st === 2 ? cols[2] : catCol[this.rec.cat[i]]; ctx.fill(); }
      if (highlight.includes(i)) { ctx.strokeStyle = '#2fb8a6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, r + 4, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.restore();
    return f;
  }
}

const room = (doorCells, extra = {}) => miniRoom({ w: 34, h: 22, openings: [{ side: 'e', at: 10, width: doorCells, name: 'Exit' }], spawn: { x0: 3, y0: 3, x1: 22, y1: 18 }, ...extra });

// ------------------------------------------------------------------------------------------------
export const EXPLAINERS = [
  {
    id: 'evac-sim', topic: 'Fundamentals', title: 'What is crowd evacuation simulation?', duration: 48,
    summary: 'A virtual drill: model the venue, add people, sound the alarm, measure.',
    explanation: 'An evacuation simulation recreates a building and its occupants in software, triggers an alarm and lets every virtual person find their way out. Because the drill is virtual, it can be repeated hundreds of times with different layouts — something no real fire drill can do safely.',
    example: 'A 18 × 12 m room with two exits and 70 people. The replay below is a real EvacPrint run recorded when you opened this explainer.',
    lab: 'exits',
    captions: [[0, 'A venue is modelled as a floor plan: walls, open floor and two exits.'], [5, 'At t = 0 the alarm sounds. Each grey ring is a person who has not reacted yet.'], [12, 'Each person starts moving after their own reaction time, heading for the quickest exit.'], [20, 'Floor colours show crowd density: green is comfortable, red is dangerous.'], [28, 'Where people arrive faster than a door can pass them, a queue forms.'], [36, 'The engine records when each person leaves. The last one sets the evacuation time (RSET).'], [44, 'Change the layout, run it again, compare: that is the idea behind EvacPrint.']],
    prepare() {
      this.rec = recordRun(miniRoom({ w: 38, h: 26, openings: [{ side: 'e', at: 11, width: 3, name: 'East exit' }, { side: 's', at: 7, width: 2, name: 'South exit' }], spawn: { x0: 3, y0: 3, x1: 28, y1: 21 } }), { occupants: 70, reactionMin: 2, reactionMax: 10, seed: 21, panic: 0.2 });
      this.view = new MiniView(this.rec);
    },
    draw(ctx, t, W, H) {
      const simT = clamp01((t - 5) / 38) * this.rec.duration;
      const fr = frameAt(this.rec, simT);
      this.view.draw(ctx, 0, 0, W, H, fr, { heat: t > 18 });
      label(ctx, `t = ${fr.t.toFixed(1)} s`, 16, 22, { bg: 'rgba(17,19,22,.85)' });
      label(ctx, `evacuated ${fr.out} / ${this.rec.N}`, 120, 22, { bg: 'rgba(17,19,22,.85)' });
      if (t > 4 && t < 9) label(ctx, 'ALARM', W / 2, 40, { color: '#fff', bg: 'rgba(224,82,74,.9)', align: 'center', size: 13, weight: 600 });
      if (t >= 36) label(ctx, `RSET = ${this.rec.result.rset.toFixed(1)} s`, W - 16, 22, { align: 'right', color: '#6fd8c9', bg: 'rgba(17,19,22,.9)', size: 14, weight: 600 });
    },
  },
  {
    id: 'dijkstra', topic: 'Algorithms', title: 'How does Dijkstra’s shortest-path algorithm work?', duration: 42,
    summary: 'A wave of increasing distance spreads out from the exit and labels every cell.',
    explanation: 'Dijkstra’s algorithm settles cells in order of their distance from the source, always expanding the closest unsettled cell next. EvacPrint runs it backwards from every exit, so each cell learns its walking distance to safety. People then simply walk “downhill”.',
    example: 'A straight step costs 1 cell, a diagonal √2 ≈ 1.41. The numbers you see are computed by the same routine the simulator uses.',
    lab: 'dijkstra',
    captions: [[0, 'Dijkstra’s algorithm finds the cheapest path from a source to every reachable cell.'], [4, 'EvacPrint starts it at the exit. The frontier spreads outward in order of distance.'], [12, 'Straight steps cost 1, diagonal steps √2. Walls are never entered, so the wave flows around them.'], [20, 'When it finishes, every cell knows its exact walking distance to safety: a distance field.'], [27, 'From any start, following decreasing distance traces the shortest path to the exit.'], [34, 'One field serves every person in the room, so routing 400 people costs no more than routing one.']],
    prepare() {
      const w = 26, h = 15;
      const open = new Uint8Array(w * h).fill(1);
      for (let y = 0; y < 10; y++) open[y * w + 8] = 0;
      for (let y = 5; y < 15; y++) open[y * w + 16] = 0;
      for (let x = 17; x < 22; x++) open[9 * w + x] = 0;
      this.g = { w, h, open, goal: 7 * w + 25, start: 12 * w + 1 };
      this.tr = dijkstraTrace(w, h, open, this.g.goal, -1);
      const back = dijkstraTrace(w, h, open, this.g.goal, this.g.start);
      this.path = back.path.slice().reverse();
      let mx = 0; for (const v of this.tr.dist) if (isFinite(v)) mx = Math.max(mx, v); this.max = mx;
    },
    draw(ctx, t, W, H) {
      const { w, h, open, goal, start } = this.g;
      const cs = Math.min((W - 40) / w, (H - 70) / h);
      const ox = (W - cs * w) / 2, oy = 40;
      const n = Math.floor(this.tr.order.length * ease((t - 3) / 20));
      const settled = new Uint8Array(w * h);
      for (let k = 0; k < n; k++) settled[this.tr.order[k]] = 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const px = ox + x * cs, py = oy + y * cs;
        if (!open[i]) { ctx.fillStyle = '#d4cdc0'; ctx.fillRect(px, py, cs - 1, cs - 1); continue; }
        if (settled[i]) {
          const v = this.tr.dist[i] / this.max;
          ctx.fillStyle = `rgba(47,184,166,${(0.6 * (1 - v) + 0.08).toFixed(3)})`;
          ctx.fillRect(px, py, cs - 1, cs - 1);
          if (cs > 22) label(ctx, this.tr.dist[i].toFixed(1), px + cs / 2, py + cs / 2, { size: Math.min(10, cs * 0.34), align: 'center', color: v < 0.4 ? '#ece6da' : '#b4ada1' });
        } else { ctx.fillStyle = '#191c20'; ctx.fillRect(px, py, cs - 1, cs - 1); }
      }
      // frontier
      if (n < this.tr.order.length && n > 0) {
        const fr = this.tr.order.slice(Math.max(0, n - 12), n);
        ctx.strokeStyle = '#e3a03a'; ctx.lineWidth = 2;
        for (const c of fr) ctx.strokeRect(ox + (c % w) * cs + 1, oy + Math.floor(c / w) * cs + 1, cs - 3, cs - 3);
      }
      const cxy = (c) => [ox + (c % w) * cs + cs / 2, oy + Math.floor(c / w) * cs + cs / 2];
      ctx.fillStyle = '#2fb8a6'; const [gx, gy] = cxy(goal); ctx.fillRect(gx - cs * 0.4, gy - cs * 0.4, cs * 0.8, cs * 0.8);
      label(ctx, 'EXIT', gx, gy - cs, { align: 'center', color: '#6fd8c9', size: 10 });
      if (t > 26) {
        const k = Math.floor(this.path.length * ease((t - 27) / 6));
        ctx.strokeStyle = '#e3a03a'; ctx.lineWidth = 3; ctx.beginPath();
        this.path.slice(0, Math.max(1, k)).forEach((c, i) => { const [x, y] = cxy(c); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
      const [sx, sy] = cxy(start);
      let ax = sx, ay = sy;
      if (t > 34) { const k = Math.min(this.path.length - 1, Math.floor((this.path.length - 1) * clamp01((t - 34) / 6))); [ax, ay] = cxy(this.path[k]); }
      ctx.fillStyle = '#ece6da'; ctx.beginPath(); ctx.arc(ax, ay, cs * 0.32, 0, Math.PI * 2); ctx.fill();
      label(ctx, `settled ${n} / ${this.tr.order.length} cells`, 16, 20, { bg: 'rgba(17,19,22,.85)' });
      if (t > 22) label(ctx, `start → exit cost ${this.tr.dist[start].toFixed(2)}`, W - 16, 20, { align: 'right', bg: 'rgba(17,19,22,.85)', color: '#f0bd6c' });
    },
  },
  {
    id: 'abm', topic: 'Fundamentals', title: 'What is agent-based modelling?', duration: 40,
    summary: 'Every person is an independent agent with its own speed, size and reaction time.',
    explanation: 'Instead of treating the crowd as a fluid, agent-based models simulate each person individually. Every agent has attributes and follows simple local rules; queues, lanes and bottlenecks emerge from thousands of these small decisions.',
    example: 'The three highlighted agents below carry their live state: reaction time, current speed and profile — read straight from the recorded run.',
    captions: [[0, 'In agent-based modelling, every person is simulated as an individual agent.'], [6, 'Each agent has its own attributes: walking speed, body size, reaction time and mobility profile.'], [14, 'Agents follow simple rules: wait, then walk toward the best exit, avoiding walls and each other.'], [22, 'Slower agents (amber) and wheelchair users (blue) change how the whole crowd flows.'], [30, 'Queues and lanes are not programmed: they emerge from these simple individual rules.']],
    prepare() {
      const L = room(3);
      L.meta.wheelchairBays = [L.w * 6 + 6, L.w * 14 + 10];
      this.rec = recordRun(L, { occupants: 34, slowFraction: 0.3, wheelchairs: 2, reactionMin: 1, reactionMax: 9, seed: 8, panic: 0.1 });
      this.view = new MiniView(this.rec);
      const idx = (c) => [...this.rec.cat].findIndex((v) => v === c);
      this.hl = [idx(0), idx(1), idx(2)].filter((i) => i >= 0);
    },
    draw(ctx, t, W, H) {
      const simT = clamp01((t - 3) / 34) * this.rec.duration;
      const fr = frameAt(this.rec, simT);
      const f = this.view.draw(ctx, 0, 0, W, H, fr, { heat: false, highlight: t > 5 ? this.hl : [] });
      if (t > 5) {
        const names = ['Adult', 'Reduced mobility', 'Wheelchair user'];
        this.hl.forEach((i, k) => {
          if (fr.st[i] === 3) return;
          const px = f.ox + fr.xs[i] * f.s, py = f.oy + fr.ys[i] * f.s;
          const bx = Math.min(W - 190, px + 16), by = Math.max(30, py - 64 + k * 6);
          ctx.fillStyle = 'rgba(17,19,22,.92)'; ctx.strokeStyle = 'rgba(47,184,166,.6)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(bx, by, 176, 58, 8); ctx.fill(); ctx.stroke();
          const state = fr.st[i] === 0 ? `reacting (${Math.max(0, this.rec.react[i] - fr.t).toFixed(1)} s)` : fr.st[i] === 2 ? 'queuing' : 'walking';
          label(ctx, names[this.rec.cat[i]], bx + 10, by + 13, { size: 11, weight: 600, font: SANS });
          label(ctx, `state  ${state}`, bx + 10, by + 30, { size: 10, color: '#b4ada1' });
          label(ctx, `speed  ${fr.sp[i].toFixed(2)} / ${this.rec.v0[i].toFixed(2)} m/s`, bx + 10, by + 45, { size: 10, color: '#b4ada1' });
        });
      }
      label(ctx, `t = ${fr.t.toFixed(1)} s · out ${fr.out}/${this.rec.N}`, 16, 20, { bg: 'rgba(17,19,22,.85)' });
    },
  },
  {
    id: 'bottleneck', topic: 'Crowd dynamics', title: 'How do bottlenecks form?', duration: 44,
    summary: 'When arrivals exceed what a door can discharge, the surplus becomes a queue.',
    explanation: 'Every opening has a maximum discharge rate, roughly proportional to its clear width (about 1.33 persons per second per metre). When people reach a door faster than that, the excess accumulates in front of it. The door is then the bottleneck: it, not the walking distance, sets the evacuation time.',
    example: '90 people, one 1.0 m exit (capacity 1.33 p/s). The counters show measured discharge and queue size from the run.',
    lab: 'width',
    captions: [[0, 'A doorway can only pass a limited number of people per second: about 1.3 per metre of width.'], [8, 'When the crowd arrives faster than that, the surplus has nowhere to go.'], [16, 'A queue builds up in front of the door and bends into an arch.'], [24, 'Density in the arch climbs past 4 people per m²: people are pressed together.'], [32, 'The door keeps working at full capacity, but every extra second is spent waiting.'], [40, 'That is a bottleneck: the door, not the walking distance, decides the evacuation time.']],
    prepare() { this.rec = recordRun(room(2), { occupants: 90, reactionMin: 0, reactionMax: 6, seed: 3, panic: 0.2 }); this.view = new MiniView(this.rec); },
    draw(ctx, t, W, H) {
      const simT = clamp01((t - 2) / 40) * this.rec.duration;
      const fr = frameAt(this.rec, simT);
      const f = this.view.draw(ctx, 0, 0, W, H, fr, {});
      const prev = frameAt(this.rec, Math.max(0, simT - 5));
      const flow = (fr.out - prev.out) / Math.max(0.2, fr.t - prev.t);
      const ex = this.rec.compiled.groups[0];
      let q = 0;
      for (let i = 0; i < this.rec.N; i++) if (fr.st[i] !== 3 && Math.hypot(fr.xs[i] - ex.cx, fr.ys[i] - ex.cy) < 3) q++;
      label(ctx, `discharge ${flow.toFixed(2)} p/s  (capacity 1.33)`, 16, 20, { bg: 'rgba(17,19,22,.85)', color: '#6fd8c9' });
      label(ctx, `within 3 m of door: ${q}`, 16, 46, { bg: 'rgba(17,19,22,.85)', color: q > 12 ? '#f08a83' : '#ece6da' });
      label(ctx, `peak density ${fr.peak.toFixed(2)} p/m² · LOS ${losFor(fr.peak)}`, W - 16, 20, { align: 'right', bg: 'rgba(17,19,22,.85)' });
      if (t > 16 && t < 34) {
        const px = f.ox + ex.cx * f.s, py = f.oy + ex.cy * f.s;
        ctx.strokeStyle = '#ff7b72'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 3 * f.s, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); ctx.setLineDash([]);
      }
    },
  },
  {
    id: 'density', topic: 'Crowd dynamics', title: 'How does crowd density affect walking speed?', duration: 40,
    summary: 'More people per square metre → shorter strides → slower walking.',
    explanation: 'Pedestrians need space to step. As density rises, stride length and speed fall, following a “fundamental diagram”. EvacPrint uses Weidmann’s (1993) relation: about 1.34 m/s when free, roughly half by 2 persons/m², and standstill at 5.4 persons/m².',
    example: '',
    lab: 'density',
    captions: [[0, 'In an empty corridor people walk at about 1.3 metres per second.'], [8, 'As density rises, each person has less space and must shorten their stride.'], [16, 'At 2 people per m² walking speed has fallen to about 0.6 m/s.'], [24, 'Above about 4 per m² the crowd barely moves; at 5.4 it stops entirely.'], [32, 'EvacPrint applies this curve to every agent at every 0.1 s step.']],
    prepare() {
      const v = (r) => (1.34 * weidmannFactor(r)).toFixed(2);
      this.example = `At 1 p/m² Weidmann gives ${v(1)} m/s; at 2 p/m² ${v(2)} m/s; at 4 p/m² ${v(4)} m/s.`;
      this.dots = Array.from({ length: 150 }, (_, i) => ({ x: ((i * 0.6180339) % 1), y: ((i * 0.38196) % 1), ph: i * 1.7 }));
      this.pos = 0;
      this.lastT = 0;
    },
    draw(ctx, t, W, H) {
      const rho = 0.15 + 5.2 * ease(t / 36);
      const v = 1.34 * weidmannFactor(rho);
      // left: 5 × 5 m box
      const bs = Math.min(W * 0.42, H - 80), bx = 30, by = (H - bs) / 2;
      ctx.strokeStyle = '#d4cdc0'; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bs, bs);
      const n = Math.min(150, Math.round(rho * 25));
      const shift = (t * 0.25 * v) % 1; // proportional to the instantaneous speed
      ctx.fillStyle = BAND[rho < 1.08 ? 0 : rho < 2.15 ? 1 : rho < 4 ? 2 : 3];
      ctx.globalAlpha = 0.18; ctx.fillRect(bx + 2, by + 2, bs - 4, bs - 4); ctx.globalAlpha = 1;
      for (let i = 0; i < n; i++) {
        const d = this.dots[i];
        const x = bx + 8 + (((d.x + shift) % 1) * (bs - 16));
        const y = by + 8 + d.y * (bs - 16);
        ctx.fillStyle = '#ece6da'; ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, bs / 60), 0, Math.PI * 2); ctx.fill();
      }
      label(ctx, '5 m × 5 m', bx + bs / 2, by - 14, { align: 'center', color: '#847e74', size: 10 });
      label(ctx, `${n} people → ρ = ${rho.toFixed(2)} p/m²`, bx, by + bs + 20, { size: 12 });
      // right: curve
      const cx = bx + bs + 60, cw = W - cx - 30, cy = by, ch = bs;
      ctx.strokeStyle = 'rgba(236,230,218,.12)'; ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(cx, cy + (k / 4) * ch); ctx.lineTo(cx + cw, cy + (k / 4) * ch); ctx.stroke(); }
      [[0, 1.08, 0], [1.08, 2.15, 1], [2.15, 4, 2], [4, 6, 3]].forEach(([a, b, i]) => { ctx.fillStyle = BAND[i]; ctx.fillRect(cx + (a / 6) * cw, cy + ch + 4, ((b - a) / 6) * cw, 4); });
      ctx.strokeStyle = '#2fb8a6'; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let r = 0.05; r <= 6; r += 0.05) { const vv = 1.34 * weidmannFactor(r); const px = cx + (r / 6) * cw, py = cy + ch - (vv / 1.4) * ch; r < 0.06 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
      const mx = cx + (rho / 6) * cw, my = cy + ch - (v / 1.4) * ch;
      ctx.fillStyle = '#e3a03a'; ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.fill();
      label(ctx, `v = ${v.toFixed(2)} m/s`, Math.min(mx + 12, cx + cw - 90), my - 16, { color: '#f0bd6c', size: 13, weight: 600 });
      label(ctx, 'speed (m/s)', cx, cy - 12, { color: '#847e74', size: 10 });
      label(ctx, 'density (p/m²) →', cx + cw, cy + ch + 22, { color: '#847e74', size: 10, align: 'right' });
      label(ctx, `LOS ${losFor(rho)}`, cx + cw, cy - 12, { align: 'right', size: 11, color: '#ece6da' });
    },
  },
  {
    id: 'fis', topic: 'Crowd dynamics', title: 'What is the faster-is-slower effect?', duration: 50,
    summary: 'Rushing crowds jam the door and get out later than calm ones.',
    explanation: 'When people push to leave faster, they compress at the exit and form arches that momentarily block it. The door’s effective discharge falls, so a hurried crowd can take longer to evacuate than a calm one. EvacPrint models this phenomenologically: under panic, door discharge drops as the density in front of it rises.',
    example: '',
    source: 'Helbing, Farkas & Vicsek (2000), “Simulating dynamical features of escape panic”, Nature 407.',
    captions: [[0, 'When people panic they push harder and try to move faster.'], [8, 'Left: a calm crowd. Right: the same crowd rushing, with 30 % faster walking.'], [16, 'At the door, pushing creates arches of people that jam the opening for moments at a time.'], [26, 'EvacPrint models this as a drop in door discharge when the crowd in front is very dense.'], [36, 'Despite walking faster, the rushing crowd takes longer to get out.'], [44, 'This is the faster-is-slower effect described by Helbing, Farkas and Vicsek (2000).']],
    prepare() {
      const p = { occupants: 60, reactionMin: 0, reactionMax: 2, seed: 11 };
      this.a = recordRun(room(2), { ...p, panic: 0 });
      this.b = recordRun(room(2), { ...p, panic: 1 });
      this.va = new MiniView(this.a); this.vb = new MiniView(this.b);
      this.dur = Math.max(this.a.duration, this.b.duration);
      this.example = `Same 60 people, same 1.0 m exit. Calm: ${this.a.result.rset.toFixed(1)} s. Rushing: ${this.b.result.rset.toFixed(1)} s — ${(this.b.result.rset - this.a.result.rset).toFixed(1)} s slower.`;
    },
    draw(ctx, t, W, H) { duel(ctx, t, W, H, this, ['Calm (panic 0)', 'Rushing (panic 1)']); },
  },
  {
    id: 'width', topic: 'Design', title: 'How can changing door width improve evacuation?', duration: 44,
    summary: 'Double the clear width, roughly double the discharge — the queue drains faster.',
    explanation: 'Because discharge capacity scales with clear width, widening the critical door is often the single most effective change. EvacPrint’s recommendation engine tests exactly this kind of modification on your venue and reports the seconds saved.',
    example: '',
    lab: 'width',
    captions: [[0, 'Same room, same 80 people, same reaction times. Only the door differs.'], [8, 'Left: a 1.0 m door. Right: a 2.0 m door.'], [16, 'A wider door passes more people per second, so the queue drains faster.'], [26, 'The narrow door becomes a bottleneck; the wide one barely forms a queue.'], [36, 'The recommendation engine tests changes like this automatically and measures the seconds saved.']],
    prepare() {
      const p = { occupants: 80, reactionMin: 0, reactionMax: 4, seed: 5, panic: 0.2 };
      this.a = recordRun(room(2), p);
      this.b = recordRun(room(4), p);
      this.va = new MiniView(this.a); this.vb = new MiniView(this.b);
      this.dur = Math.max(this.a.duration, this.b.duration);
      this.example = `80 people. 1.0 m door: ${this.a.result.rset.toFixed(1)} s. 2.0 m door: ${this.b.result.rset.toFixed(1)} s — ${(this.a.result.rset - this.b.result.rset).toFixed(1)} s saved.`;
    },
    draw(ctx, t, W, H) { duel(ctx, t, W, H, this, ['1.0 m door', '2.0 m door']); },
  },
  {
    id: 'twin', topic: 'Design', title: 'How does a digital twin support building safety?', duration: 40,
    summary: 'A virtual copy of the venue, kept in step with reality, tests emergencies safely.',
    explanation: 'A digital twin is a virtual model linked to a real asset. EvacPrint’s model is built from the measured layout of the hall and takes a live occupancy count, so it can test “what if there were 400 people and Door B were blocked?” without putting anyone at risk. Sensor feeds (entry counters, CCTV head-counts) are future scope.',
    example: 'Today: measured layout + occupancy entered by staff. Future: counters update the twin automatically and it alerts when a configuration becomes unsafe.',
    captions: [[0, 'A digital twin is a virtual model kept in step with a real building.'], [7, 'EvacPrint’s model is built from the measured layout of the venue.'], [14, 'A live occupancy count sets how many people the simulation contains.'], [21, 'The model tests what would happen in an emergency, without risking anyone.'], [28, 'Its findings, bottlenecks and fixes, flow back as changes to the real venue.'], [34, 'Future versions can use entry counters and cameras to update occupancy automatically.']],
    prepare() {
      this.c = compile(createHall406());
      this.geo = planGeometry(this.c);
    },
    draw(ctx, t, W, H) {
      const bw = W * 0.34, bh = H * 0.5, ly = H * 0.18;
      // physical venue (drawing)
      const lx = 24;
      ctx.strokeStyle = '#d4cdc0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx, ly + bh * 0.3); ctx.lineTo(lx + bw / 2, ly); ctx.lineTo(lx + bw, ly + bh * 0.3); ctx.lineTo(lx + bw, ly + bh); ctx.lineTo(lx, ly + bh); ctx.closePath(); ctx.stroke();
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { ctx.fillStyle = '#3a4048'; ctx.fillRect(lx + 18 + c * (bw - 36) / 6, ly + bh * 0.42 + r * 16, (bw - 36) / 6 - 6, 8); }
      ctx.fillStyle = '#2fb8a6'; ctx.fillRect(lx + bw - 4, ly + bh - 34, 6, 28);
      label(ctx, 'PHYSICAL VENUE', lx + bw / 2, ly + bh + 22, { align: 'center', size: 10, color: '#b4ada1' });
      // virtual model
      const rx = W - bw - 24;
      const f = computeFit(this.c, bw, bh, 4);
      ctx.save(); ctx.translate(rx, ly);
      drawUnder(ctx, this.c, this.geo, f, { labels: false, grid: false, bg: '#111316' });
      drawOver(ctx, this.c, this.geo, f, { dims: false });
      ctx.restore();
      label(ctx, 'VIRTUAL MODEL (EvacPrint)', rx + bw / 2, ly + bh + 22, { align: 'center', size: 10, color: '#6fd8c9' });
      // flows
      const flows = [[7, 'measured layout', 0.3, 1], [14, 'occupancy count', 0.5, 1], [28, 'recommended fixes', 0.75, -1]];
      flows.forEach(([t0, txt, fy, dir]) => {
        if (t < t0) return;
        const y = ly + bh * fy, x0 = lx + bw + 14, x1 = rx - 14;
        ctx.strokeStyle = dir > 0 ? 'rgba(47,184,166,.7)' : 'rgba(227,160,58,.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
        const p = ((t * 0.5) % 1);
        const px = dir > 0 ? x0 + (x1 - x0) * p : x1 - (x1 - x0) * p;
        ctx.fillStyle = dir > 0 ? '#2fb8a6' : '#e3a03a'; ctx.beginPath(); ctx.arc(px, y, 4, 0, Math.PI * 2); ctx.fill();
        label(ctx, txt, (x0 + x1) / 2, y - 12, { align: 'center', size: 10.5, color: dir > 0 ? '#6fd8c9' : '#f0bd6c' });
      });
      if (t > 21) label(ctx, 'what-if: 400 people, Door B blocked', rx + bw / 2, ly - 16, { align: 'center', size: 10.5, bg: 'rgba(224,82,74,.18)', color: '#f08a83' });
      if (t > 34) label(ctx, 'future: entry counters · CCTV head-count', W / 2, H - 70, { align: 'center', size: 10.5, color: '#847e74', bg: 'rgba(255,255,255,.04)' });
    },
  },
];

function duel(ctx, t, W, H, self, names) {
  const gap = 10, w = (W - gap) / 2;
  const simT = clamp01((t - 4) / 42) * self.dur;
  [[self.a, self.va], [self.b, self.vb]].forEach(([rec, view], k) => {
    const fr = frameAt(rec, Math.min(simT, rec.duration));
    view.draw(ctx, k * (w + gap), 34, w, H - 110, fr, {});
    const x = k * (w + gap) + 12;
    label(ctx, names[k], x, 18, { size: 12, weight: 600, font: SANS, color: k ? '#f0bd6c' : '#6fd8c9' });
    label(ctx, `out ${fr.out}/${rec.N}`, k * (w + gap) + w - 12, 18, { align: 'right', size: 11 });
    const done = simT >= rec.duration;
    if (done) label(ctx, `all out at ${rec.result.rset.toFixed(1)} s`, k * (w + gap) + w / 2, 60, { align: 'center', bg: 'rgba(17,19,22,.9)', color: '#fff', size: 12, weight: 600 });
  });
  label(ctx, `t = ${simT.toFixed(1)} s`, W / 2, H - 66, { align: 'center', bg: 'rgba(17,19,22,.85)' });
}

export const TOPICS = ['All', 'Fundamentals', 'Algorithms', 'Crowd dynamics', 'Design'];
