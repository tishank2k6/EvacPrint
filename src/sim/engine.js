// EvacPrint simulation engine.
//
// Model: continuous-space agents on a 0.5 m navigation grid.
//  • Route choice   — one Dijkstra distance field per open exit, recomputed every
//                     2 s with a congestion cost (dynamic floor field). Each agent
//                     follows the exit with the lowest cost, with hysteresis.
//  • Locomotion     — desired velocity along the interpolated field gradient,
//                     speed reduced by local density (Weidmann 1993 fundamental
//                     diagram), first-order relaxation (τ = 0.5 s).
//  • Collisions     — position-based overlap resolution between agents (disc
//                     bodies) and against walls/furniture.
//  • Openings       — doors and exits discharge at most 1.33 persons/s per metre
//                     of clear width (SFPE specific flow). Agents queue until the
//                     opening admits them. Under panic, discharge efficiency drops
//                     at high door-front density (phenomenological faster-is-slower
//                     clogging, after Helbing et al. 2000).
//  • Pre-movement   — every agent waits for an individual reaction time.
// The engine is pure JS with no DOM access: the same code runs in the browser,
// in the recommendation Web Worker and in Node (scripts/sim-check.mjs).

import { CELL, T, compile, describeLocation } from './layout.js';
import { distanceField, wallPenalty, DX, DY } from './pathfinding.js';
import { createRng } from './rng.js';

export const MODEL = {
  dt: 0.1,
  tau: 0.5,
  adultSpeed: { mean: 1.34, sd: 0.15, min: 1.0, max: 1.6 },
  slowSpeed: { min: 0.7, max: 1.0 },
  wheelchairSpeed: { min: 0.7, max: 1.0 },
  radius: [0.22, 0.23, 0.36],
  weidmann: { gamma: 1.913, rhoMax: 5.4 },
  specificFlow: 1.33, // persons / s / m clear width
  fieldInterval: 2.0, // s between distance-field updates
  congestionWeight: 0.45,
  losF: 2.15, // Fruin walkway LOS F lower bound, persons / m²
  critical: 4.0,
  emaTau: 1.0, // s, smoothing for the displayed/analysed density
  kernelR: 0.7, // m, Gaussian density kernel radius
};

export const CATEGORY = ['Adult', 'Reduced mobility', 'Wheelchair user'];
export const STATE = { WAITING: 0, MOVING: 1, EVACUATED: 2, TRAPPED: 3 };

export const DEFAULT_PARAMS = {
  occupants: 200,
  slowFraction: 0.05,
  wheelchairs: 0,
  reactionMin: 10,
  reactionMax: 30,
  panic: 0.2,
  seed: 406,
  maxTime: 600,
};

/** Weidmann (1993) speed factor v(ρ)/v0. */
export function weidmannFactor(rho) {
  if (rho <= 0.05) return 1;
  const { gamma, rhoMax } = MODEL.weidmann;
  if (rho >= rhoMax) return 0;
  return Math.max(0, 1 - Math.exp(-gamma * (1 / rho - 1 / rhoMax)));
}

/** Fruin walkway level of service for a density in persons / m². */
export function losFor(rho) {
  if (rho < 0.31) return 'A';
  if (rho < 0.43) return 'B';
  if (rho < 0.72) return 'C';
  if (rho < 1.08) return 'D';
  if (rho < 2.15) return 'E';
  return 'F';
}

/** 4-band scale used by every heatmap in the product. */
export function densityBand(rho) {
  if (rho < 1.08) return 0; // low (LOS A–D)
  if (rho < 2.15) return 1; // moderate (LOS E)
  if (rho < 4.0) return 2; // high (LOS F)
  return 3; // critical (crush-risk territory)
}
export const BAND_NAMES = ['Low', 'Moderate', 'High', 'Critical'];

export class Simulation {
  constructor(layout, params = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.layout = layout;
    this.c = compile(layout);
    const { n } = this.c;
    this.dt = MODEL.dt;
    this.t = 0;
    this.stepCount = 0;
    this.rng = createRng(this.params.seed);
    this.penalty = wallPenalty(this.c);

    // Density fields
    this.cellCount = new Uint16Array(n);
    this.density = new Float32Array(n); // instantaneous, persons / m²
    this.densityEMA = new Float32Array(n);
    this.exposure = new Float32Array(n); // seconds spent ≥ LOS F
    this.peakMap = new Float32Array(n);
    this.congestion = new Float32Array(n).fill(1);

    // Openings
    const groups = this.c.groups;
    this.gateBucket = new Float32Array(groups.length).fill(1);
    this.gateRate = groups.map((g) => g.widthM * MODEL.specificFlow);
    this.gatePasses = groups.map(() => []); // pass times
    this.gateQueue = new Uint16Array(groups.length);
    // approach cells (within 1 m of an opening) where door-front density is measured
    this.gateFront = groups.map((g) => {
      const set = new Set();
      const { w, h, passable, groupOf } = this.c;
      for (const c of g.cells) {
        const cx = c % w, cy = (c - cx) / w;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const j = y * w + x;
            if (passable[j] && groupOf[j] !== g.id) set.add(j);
          }
      }
      return [...set];
    });

    // Per-exit fields
    this.exitIds = this.c.exits.map((g) => g.id);
    this.fields = this.exitIds.map(() => new Float32Array(n));
    this.gradX = this.exitIds.map(() => new Float32Array(n));
    this.gradY = this.exitIds.map(() => new Float32Array(n));
    this.combined = new Float32Array(n);
    this.fieldVersion = 0;
    this.updateFields(false);

    // Optional venue configuration (Venue Studio): per-opening flow and
    // accessibility, unfamiliar-occupant route bias, and slow zones (stairs,
    // ramps, smoke). All inactive for layouts that do not define them.
    const exitProps = this.layout.meta?.exitProps || null;
    if (exitProps) {
      groups.forEach((g, k) => { const f = exitProps[g.name]?.flow; if (f > 0) this.gateRate[k] = g.widthM * f; });
    }
    if (exitProps || this.params.unfamiliarPenalty) {
      const accessible = this.exitIds.map((id) => exitProps?.[groups[id].name]?.accessible !== false);
      const main = this.layout.meta?.mainEntrance;
      this.exitInfo = {
        accessible,
        anyAccessible: accessible.some(Boolean),
        mainIndex: this.exitIds.findIndex((id) => groups[id].name === main),
        unfamiliarPenalty: this.params.unfamiliarPenalty || 0,
      };
    }
    this.zoneMul = null;
    const zones = this.layout.meta?.speedZones;
    if (zones?.length) {
      this.zoneMul = [new Float32Array(n).fill(1), new Float32Array(n).fill(1), new Float32Array(n).fill(1)];
      for (const z of zones) for (const cell of z.cells) for (let k = 0; k < 3; k++) this.zoneMul[k][cell] = Math.min(this.zoneMul[k][cell], z.mult[k]);
    }

    this.spawn();

    this.curve = [];
    this.nextSample = 0;
    this.liveBottlenecks = [];
    this.nextBottleneckScan = 0;
    this.peak = { value: 0, x: 0, y: 0, t: 0 };
    this.evacuated = 0;
    this.trapped = 0;
    this.lastEvacT = 0;
    this.sample();
  }

  // -------------------------------------------------------------------------
  spawn() {
    const { params, c, rng } = this;
    const N = Math.max(0, Math.round(params.occupants));
    const nW = Math.min(Math.round(params.wheelchairs || 0), N);
    const cap = N;
    this.N = N;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.r = new Float32Array(cap);
    this.v0 = new Float32Array(cap);
    this.react = new Float32Array(cap);
    this.cat = new Uint8Array(cap);
    this.state = new Uint8Array(cap);
    this.seated = new Uint8Array(cap);
    this.congested = new Uint8Array(cap);
    this.exitSel = new Int16Array(cap).fill(-1); // index into exitIds
    this.passed = new Uint32Array(cap);
    this.doorVia = new Int16Array(cap).fill(-1);
    this.exitVia = new Int16Array(cap).fill(-1);
    this.exitT = new Float32Array(cap).fill(-1);
    this.waitT = new Float32Array(cap);
    this.startT = new Float32Array(cap).fill(-1);

    const { w } = c;
    const seats = rng.shuffle([...c.seats]);
    const stand = rng.shuffle([...c.standCells]);
    const bays = (this.layout.meta.wheelchairBays || []).filter((b) => c.passable[b]);
    const panicReact = 1 - 0.35 * params.panic;

    // decide categories
    const cats = new Uint8Array(N);
    for (let i = 0; i < nW; i++) cats[i] = 2;
    const nSlow = Math.round((N - nW) * params.slowFraction);
    for (let i = nW; i < nW + nSlow; i++) cats[i] = 1;

    // Optional configured population (Venue Studio wizard). When absent the
    // original behaviour above is used unchanged.
    const prof = Array.isArray(params.profiles) && params.profiles.length ? expandProfiles(params.profiles, N, rng) : null;
    this.familiar = new Uint8Array(cap).fill(1);
    this.profileOf = new Uint8Array(cap);
    this.spawnX = new Float32Array(cap);
    this.spawnY = new Float32Array(cap);
    const pools = params.spawn ? spawnPools(c, this.layout, params.spawn, N, rng) : null;
    const reactAdd = params.reactionAdd || 0;
    const speedFactor = params.speedFactor || 1;

    let si = 0;
    let st = 0;
    let bi = 0;
    for (let i = 0; i < N; i++) {
      const p = prof ? prof[i] : null;
      const k = p ? p.cat : cats[i];
      this.cat[i] = k;
      this.r[i] = p?.radius || MODEL.radius[k];
      if (p && p.vMin != null) {
        this.v0[i] = rng.range(p.vMin, p.vMax);
      } else if (k === 0) {
        const s = MODEL.adultSpeed;
        this.v0[i] = Math.min(s.max, Math.max(s.min, rng.normal(s.mean, s.sd)));
      } else {
        const s = k === 1 ? MODEL.slowSpeed : MODEL.wheelchairSpeed;
        this.v0[i] = rng.range(s.min, s.max);
      }
      this.v0[i] *= speedFactor;
      const u = (rng.next() + rng.next()) / 2;
      this.react[i] = (params.reactionMin + (params.reactionMax - params.reactionMin) * u) * panicReact * (p ? p.reactMul ?? 1 : k === 0 ? 1 : 1.15) + reactAdd + (p?.reactAdd || 0);
      if (p) { this.familiar[i] = rng.next() < (p.familiar ?? 1) ? 1 : 0; this.profileOf[i] = p.id; }

      let cell = -1;
      let seated = 0;
      if (pools) {
        const pick = pools.take(k === 2 ? 'wheel' : null);
        cell = pick.cell; seated = pick.seated;
      } else if (k === 2) {
        cell = bi < bays.length ? bays[bi++] : stand[st++];
      } else if (si < seats.length) {
        cell = seats[si++];
        seated = 1;
      } else if (st < stand.length) {
        cell = stand[st++];
      }
      if (cell == null || cell < 0) {
        // venue physically full: place nothing more
        this.N = i;
        break;
      }
      const cx = cell % w;
      const cy = (cell - cx) / w;
      if (seated) {
        this.x[i] = (cx + 0.5) * CELL;
        this.y[i] = cy * CELL + 0.12;
      } else {
        this.x[i] = (cx + 0.5) * CELL + rng.range(-0.06, 0.06);
        this.y[i] = (cy + 0.5) * CELL + rng.range(-0.06, 0.06);
      }
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.spawnX[i] = this.x[i];
      this.spawnY[i] = this.y[i];
      this.seated[i] = seated;
      this.state[i] = STATE.WAITING;
    }
    // initial exit choice
    for (let i = 0; i < this.N; i++) this.chooseExit(i, true);
  }

  // -------------------------------------------------------------------------
  updateFields(withCongestion = true) {
    const { c } = this;
    const k = MODEL.congestionWeight * (1 - 0.7 * this.params.panic);
    if (withCongestion) {
      for (let i = 0; i < c.n; i++) this.congestion[i] = 1 + k * this.densityEMA[i];
    }
    this.combined.fill(Infinity);
    for (let e = 0; e < this.exitIds.length; e++) {
      const g = c.groups[this.exitIds[e]];
      const f = distanceField(c, g.cells, withCongestion ? this.congestion : null, this.penalty, this.fields[e]);
      this.computeGradient(f, this.gradX[e], this.gradY[e]);
      for (let i = 0; i < c.n; i++) if (f[i] < this.combined[i]) this.combined[i] = f[i];
    }
    this.fieldVersion++;
  }

  computeGradient(f, gx, gy) {
    const { w, h, passable } = this.c;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        gx[i] = 0;
        gy[i] = 0;
        if (!passable[i] || !isFinite(f[i])) continue;
        const fc = f[i];
        let sx = 0, sy = 0;
        let best = fc, bdx = 0, bdy = 0;
        for (let d = 0; d < 8; d++) {
          const xx = x + DX[d], yy = y + DY[d];
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!passable[j]) continue;
          if (d >= 4 && (!passable[y * w + xx] || !passable[yy * w + x])) continue;
          const fj = f[j];
          if (fj < fc) {
            const len = d < 4 ? 1 : Math.SQRT2;
            const wgt = (fc - fj) / len;
            sx += (wgt * DX[d]) / len;
            sy += (wgt * DY[d]) / len;
            if (fj < best) { best = fj; bdx = DX[d]; bdy = DY[d]; }
          }
        }
        let m = Math.hypot(sx, sy);
        if (m < 1e-6) { sx = bdx; sy = bdy; m = Math.hypot(sx, sy); }
        if (m > 0) { gx[i] = sx / m; gy[i] = sy / m; }
      }
  }

  cellOf(x, y) {
    const cx = Math.min(this.c.w - 1, Math.max(0, Math.floor(x / CELL)));
    const cy = Math.min(this.c.h - 1, Math.max(0, Math.floor(y / CELL)));
    return cy * this.c.w + cx;
  }

  /** nearest passable cell to an agent (seated agents sit inside seat cells) */
  navCell(i) {
    const c = this.cellOf(this.x[i], this.y[i]);
    if (this.c.passable[c]) return c;
    const { w, h, passable } = this.c;
    const cx = c % w, cy = (c - cx) / w;
    let best = -1, bd = Infinity;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!passable[j]) continue;
        const d = Math.hypot((xx + 0.5) * CELL - this.x[i], (yy + 0.5) * CELL - this.y[i]);
        if (d < bd) { bd = d; best = j; }
      }
    return best;
  }

  chooseExit(i, initial = false) {
    const cell = this.navCell(i);
    if (cell < 0) return;
    let best = -1, bc = Infinity;
    const ex = this.exitInfo;
    // wheelchair users avoid exits marked inaccessible when any accessible exit is reachable
    const wheel = this.cat[i] === 2 && ex && ex.anyAccessible;
    const bias = ex && !this.familiar[i] ? ex.unfamiliarPenalty : 0;
    const costOf = (e) => {
      let v = this.fields[e][cell];
      if (!ex) return v;
      if (wheel && !ex.accessible[e]) return Infinity;
      if (bias && e !== ex.mainIndex) v += bias; // unfamiliar occupants prefer the way they came in
      return v;
    };
    for (let e = 0; e < this.fields.length; e++) {
      const v = costOf(e);
      if (v < bc) { bc = v; best = e; }
    }
    const cur = this.exitSel[i];
    if (best < 0) { this.exitSel[i] = -1; return; }
    if (initial || cur < 0) { this.exitSel[i] = best; return; }
    const cc = costOf(cur);
    // hysteresis: switch only for a clear (15 %, ≥1.5 m) improvement
    if (!isFinite(cc) || bc < cc * 0.85 - 1.5) this.exitSel[i] = best;
  }

  /** bilinear interpolation of the exit field gradient at a point */
  direction(i, e) {
    const { w, h, passable } = this.c;
    const gx = this.gradX[e], gy = this.gradY[e];
    const fx = this.x[i] / CELL - 0.5;
    const fy = this.y[i] / CELL - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let sx = 0, sy = 0, sw = 0;
    for (let k = 0; k < 4; k++) {
      const xx = x0 + (k & 1), yy = y0 + (k >> 1);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!passable[j]) continue;
      const wt = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
      sx += gx[j] * wt; sy += gy[j] * wt; sw += wt;
    }
    if (sw < 1e-6) {
      const c = this.navCell(i);
      if (c >= 0) return [gx[c], gy[c]];
      return [0, 0];
    }
    const m = Math.hypot(sx, sy);
    if (m < 1e-6) {
      const c = this.navCell(i);
      return c >= 0 ? [gx[c], gy[c]] : [0, 0];
    }
    return [sx / m, sy / m];
  }

  // -------------------------------------------------------------------------
  step() {
    const { dt, c, params } = this;
    const { w, h, passable, groupOf, groups, cells } = c;
    const N = this.N;
    const panic = params.panic;
    this.t += dt;
    this.stepCount++;

    // field refresh (dynamic congestion-aware routing)
    if (this.stepCount % Math.round(MODEL.fieldInterval / dt) === 0) {
      this.updateFields(true);
      for (let i = 0; i < N; i++) if (this.state[i] === STATE.MOVING) this.chooseExit(i);
    }

    // gate token buckets (door / exit discharge capacity)
    for (let g = 0; g < groups.length; g++) {
      if (groups[g].blocked) continue;
      let rhoFront = 0;
      for (const cell of this.gateFront[g]) rhoFront = Math.max(rhoFront, this.density[cell]);
      const clog = 1 - 0.45 * panic * Math.min(1, Math.max(0, (rhoFront - 2.5) / 2.5));
      this.gateBucket[g] = Math.min(1, this.gateBucket[g] + this.gateRate[g] * clog * dt);
      this.gateQueue[g] = 0;
    }

    for (let i = 0; i < N; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
    }

    // 1. desired motion
    const speedBoost = 1 + 0.3 * panic;
    for (let i = 0; i < N; i++) {
      const s = this.state[i];
      if (s === STATE.EVACUATED || s === STATE.TRAPPED) continue;
      if (s === STATE.WAITING) {
        if (this.t < this.react[i]) continue;
        this.state[i] = STATE.MOVING;
        this.startT[i] = this.t;
        this.chooseExit(i, true);
      }
      const e = this.exitSel[i];
      if (e < 0) {
        this.state[i] = STATE.TRAPPED;
        this.trapped++;
        continue;
      }
      const [dx, dy] = this.direction(i, e);
      const cell = this.cellOf(this.x[i], this.y[i]);
      const rho = Math.max(0, this.density[cell] - 0.55); // exclude own kernel contribution
      let vDes = this.v0[i] * speedBoost * Math.max(0.06, weidmannFactor(rho));
      if (this.zoneMul) vDes *= this.zoneMul[this.cat[i]][cell];
      const k = dt / MODEL.tau;
      this.vx[i] += (dx * vDes - this.vx[i]) * k;
      this.vy[i] += (dy * vDes - this.vy[i]) * k;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }

    // 2. agent–agent overlap resolution via cell buckets
    const head = this._head || (this._head = new Int32Array(c.n));
    const next = this._next && this._next.length >= N ? this._next : (this._next = new Int32Array(Math.max(N, 1)));
    head.fill(-1);
    for (let i = 0; i < N; i++) {
      const s = this.state[i];
      if (s === STATE.EVACUATED || s === STATE.TRAPPED) continue;
      if (s === STATE.WAITING && this.seated[i]) continue;
      const cell = this.cellOf(this.x[i], this.y[i]);
      next[i] = head[cell];
      head[cell] = i;
    }
    // Three Gauss–Seidel passes of full overlap correction keep bodies from
    // interpenetrating, so crowd density saturates near the physical limit.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < N; i++) {
        const s = this.state[i];
        if (s !== STATE.MOVING && !(s === STATE.WAITING && !this.seated[i])) continue;
        const cx = Math.floor(this.x[i] / CELL), cy = Math.floor(this.y[i] / CELL);
        for (let yy = cy - 1; yy <= cy + 1; yy++) {
          if (yy < 0 || yy >= h) continue;
          for (let xx = cx - 1; xx <= cx + 1; xx++) {
            if (xx < 0 || xx >= w) continue;
            for (let j = head[yy * w + xx]; j !== -1; j = next[j]) {
              if (j <= i) continue;
              let ddx = this.x[j] - this.x[i];
              let ddy = this.y[j] - this.y[i];
              const minD = this.r[i] + this.r[j];
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 >= minD * minD) continue;
              let d = Math.sqrt(d2);
              if (d < 1e-5) { ddx = 0.01 * (this.rng.next() - 0.5); ddy = 0.01; d = Math.hypot(ddx, ddy); }
              const overlap = (minD - d) * 0.9;
              const ux = ddx / d, uy = ddy / d;
              const mi = this.state[i] === STATE.MOVING ? 1 : 0.1;
              const mj = this.state[j] === STATE.MOVING ? 1 : 0.1;
              const si = (overlap * mi) / (mi + mj);
              const sj = (overlap * mj) / (mi + mj);
              this.x[i] -= ux * si; this.y[i] -= uy * si;
              this.x[j] += ux * sj; this.y[j] += uy * sj;
            }
          }
        }
      }
    }

    // 3. walls, furniture and gates
    for (let i = 0; i < N; i++) {
      if (this.state[i] !== STATE.MOVING) continue;
      const r = this.r[i];
      let x = this.x[i], y = this.y[i];
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      let pushX = 0, pushY = 0;
      let atGate = -1;
      const e = this.exitSel[i];
      const f = this.fields[e];
      const myCell = this.cellOf(x, y);
      const myG = groupOf[myCell];
      if (myG >= 0 && passable[myCell] && !(this.passed[i] & (1 << myG))) {
        // squeezed into an opening without admission: admit if capacity allows, else step back
        if (this.gateBucket[myG] >= 1) {
          this.gateBucket[myG] -= 1;
          this.passed[i] |= 1 << myG;
          this.gatePasses[myG].push(this.t);
          if (groups[myG].type === 'door' && this.doorVia[i] < 0) this.doorVia[i] = myG;
        } else {
          this.x[i] = this.px[i]; this.y[i] = this.py[i];
          this.vx[i] = this.vy[i] = 0;
          this.congested[i] = 1;
          this.waitT[i] += dt;
          this.gateQueue[myG]++;
          continue;
        }
      }
      let navX = 0, navY = 0;
      if (!passable[myCell]) {
        const nc = this.navCell(i);
        if (nc >= 0) { navX = ((nc % w) + 0.5) * CELL; navY = (Math.floor(nc / w) + 0.5) * CELL; }
      }
      for (let yy = cy - 1; yy <= cy + 1; yy++)
        for (let xx = cx - 1; xx <= cx + 1; xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          let solid = !passable[j];
          const g = groupOf[j];
          if (!solid && g >= 0 && !(this.passed[i] & (1 << g)) && j !== myCell) {
            // an opening this agent has not been admitted through yet
            const nearX = Math.max(xx * CELL, Math.min(x, (xx + 1) * CELL));
            const nearY = Math.max(yy * CELL, Math.min(y, (yy + 1) * CELL));
            const dist = Math.hypot(x - nearX, y - nearY);
            if (f[j] < f[myCell] && dist < r + 0.08) {
              this.gateQueue[g]++;
              if (this.gateBucket[g] >= 1) {
                this.gateBucket[g] -= 1;
                this.passed[i] |= 1 << g;
                this.gatePasses[g].push(this.t);
                if (groups[g].type === 'door' && this.doorVia[i] < 0) this.doorVia[i] = g;
                continue;
              }
              atGate = g;
            }
            solid = true;
          }
          if (!solid) continue;
          const nx = Math.max(xx * CELL, Math.min(x, (xx + 1) * CELL));
          const ny = Math.max(yy * CELL, Math.min(y, (yy + 1) * CELL));
          let ddx = x - nx, ddy = y - ny;
          const d = Math.hypot(ddx, ddy);
          if (d >= r) continue;
          if (d < 1e-6) {
            // centre inside a solid cell (e.g. standing up from a seat):
            // move towards the nearest walkable cell
            ddx = navX - x; ddy = navY - y;
            const m = Math.hypot(ddx, ddy) || 1;
            pushX += (ddx / m) * r; pushY += (ddy / m) * r;
          } else {
            pushX += (ddx / d) * (r - d);
            pushY += (ddy / d) * (r - d);
          }
        }
      const pm = Math.hypot(pushX, pushY);
      const cap = 0.12;
      if (pm > cap) { pushX *= cap / pm; pushY *= cap / pm; }
      x += pushX; y += pushY;
      // cancel velocity into the obstacle
      if (pm > 1e-6) {
        const nx = pushX / pm, ny = pushY / pm;
        const vn = this.vx[i] * nx + this.vy[i] * ny;
        if (vn < 0) { this.vx[i] -= vn * nx; this.vy[i] -= vn * ny; }
      }
      this.x[i] = x; this.y[i] = y;

      // congestion flag & waiting time
      const sp = Math.hypot(this.x[i] - this.px[i], this.y[i] - this.py[i]) / dt;
      const cong = sp < 0.35 * this.v0[i] && (atGate >= 0 || this.density[this.cellOf(x, y)] >= 1.4);
      this.congested[i] = cong ? 1 : 0;
      if (cong) this.waitT[i] += dt;

      // evacuated?
      const cell = this.cellOf(x, y);
      if (cells[cell] === T.EXIT && (this.passed[i] & (1 << groupOf[cell]))) {
        this.state[i] = STATE.EVACUATED;
        this.exitVia[i] = groupOf[cell];
        this.exitT[i] = this.t;
        this.evacuated++;
        this.lastEvacT = this.t;
        this.vx[i] = this.vy[i] = 0;
      }
    }

    this.computeDensity();
    if (this.t + 1e-9 >= this.nextSample) this.sample();
    if (this.t + 1e-9 >= this.nextBottleneckScan) {
      this.liveBottlenecks = this.scanBottlenecks(this.densityEMA, MODEL.losF, 2);
      this.nextBottleneckScan = this.t + 0.5;
    }
  }

  computeDensity() {
    const { c, dt } = this;
    const { w, h, n, passable } = c;
    // Gaussian-kernel local density (Helbing, Johansson & Al-Abideen 2007):
    // ρ(r) = Σ_j exp(−|r_j − r|² / R²) / (π R²), R = 0.7 m, evaluated at cell centres.
    const R = MODEL.kernelR;
    const invR2 = 1 / (R * R);
    const norm = 1 / (Math.PI * R * R);
    const reach = Math.ceil((2 * R) / CELL);
    const den = this.density;
    den.fill(0);
    for (let i = 0; i < this.N; i++) {
      if (this.state[i] !== STATE.MOVING) continue;
      const ax = this.x[i], ay = this.y[i];
      const cx = Math.floor(ax / CELL), cy = Math.floor(ay / CELL);
      for (let yy = cy - reach; yy <= cy + reach; yy++) {
        if (yy < 0 || yy >= h) continue;
        const ddy = (yy + 0.5) * CELL - ay;
        for (let xx = cx - reach; xx <= cx + reach; xx++) {
          if (xx < 0 || xx >= w) continue;
          const ddx = (xx + 0.5) * CELL - ax;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > 4 * R * R) continue;
          den[yy * w + xx] += Math.exp(-d2 * invR2) * norm;
        }
      }
    }
    const alpha = 1 - Math.exp(-dt / MODEL.emaTau);
    const ema = this.densityEMA;
    let pk = 0, pki = -1;
    for (let i = 0; i < n; i++) {
      const d = passable[i] ? den[i] : 0;
      den[i] = d;
      ema[i] += (d - ema[i]) * alpha;
      const e = ema[i];
      if (e > this.peakMap[i]) this.peakMap[i] = e;
      if (e >= MODEL.losF) this.exposure[i] += dt;
      if (e > pk) { pk = e; pki = i; }
    }
    this.currentPeak = pk;
    if (pk > this.peak.value) {
      const x = pki % w, y = (pki - x) / w;
      this.peak = { value: pk, x: (x + 0.5) * CELL, y: (y + 0.5) * CELL, t: this.t };
    }
  }

  sample() {
    let moving = 0, congested = 0, waiting = 0;
    for (let i = 0; i < this.N; i++) {
      const s = this.state[i];
      if (s === STATE.MOVING) { moving++; if (this.congested[i]) congested++; }
      else if (s === STATE.WAITING) waiting++;
    }
    this.curve.push({
      t: Math.round(this.t * 10) / 10,
      evacuated: this.evacuated,
      moving,
      waiting,
      congested,
      peak: Math.round((this.currentPeak || 0) * 100) / 100,
    });
    this.nextSample = Math.floor(this.t + 1e-9) + 1;
  }

  /** connected components of cells whose value ≥ threshold */
  scanBottlenecks(map, threshold, minCells) {
    const { w, h, n, passable } = this.c;
    const seen = this._seen && this._seen.length === n ? this._seen : (this._seen = new Uint8Array(n));
    seen.fill(0);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (seen[i] || !passable[i] || map[i] < threshold) continue;
      const stack = [i];
      seen[i] = 1;
      let sx = 0, sy = 0, sw = 0, peak = 0, size = 0, exp = 0, peakCell = i;
      while (stack.length) {
        const cc = stack.pop();
        const x = cc % w, y = (cc - x) / w;
        const v = map[cc];
        sx += (x + 0.5) * v; sy += (y + 0.5) * v; sw += v; size++;
        exp += this.exposure[cc];
        if (this.peakMap[cc] > peak) { peak = this.peakMap[cc]; peakCell = cc; }
        for (let d = 0; d < 8; d++) {
          const xx = x + DX[d], yy = y + DY[d];
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!seen[j] && passable[j] && map[j] >= threshold) { seen[j] = 1; stack.push(j); }
        }
      }
      if (size < minCells) continue;
      const cx = (sx / sw) * CELL, cy = (sy / sw) * CELL;
      out.push({
        x: cx, y: cy, size, areaM2: size * CELL * CELL,
        peak: Math.round(peak * 100) / 100,
        current: Math.round((map === this.densityEMA ? sw / size : 0) * 100) / 100,
        exposure: Math.round(exp * 10) / 10,
        label: describeLocation(this.c, cx, cy),
      });
    }
    out.sort((a, b) => b.exposure * b.peak - a.exposure * a.peak || b.size - a.size);
    return out;
  }

  get done() {
    return this.evacuated + this.trapped >= this.N || this.t >= this.params.maxTime;
  }

  runToEnd(onProgress) {
    let k = 0;
    while (!this.done) {
      this.step();
      if (onProgress && ++k % 200 === 0) onProgress(this.t);
    }
    if (this.curve.at(-1).t < this.t) this.sample();
    return this.summary();
  }

  /** Per-profile outcome (configured populations only). */
  profileStats() {
    const P = this.params.profiles;
    return P.map((p, k) => {
      let n = 0, out = 0, sum = 0, max = 0;
      for (let i = 0; i < this.N; i++) {
        if (this.profileOf[i] !== (p.id ?? k)) continue;
        n++;
        if (this.state[i] === STATE.EVACUATED) { out++; sum += this.exitT[i]; max = Math.max(max, this.exitT[i]); }
      }
      return { label: p.label, n, evacuated: out, meanExit: out ? Math.round((sum / out) * 10) / 10 : null, lastExit: out ? Math.round(max * 10) / 10 : null };
    }).filter((s) => s.n > 0);
  }

  /** Complete, serialisable result of the run — every number in the UI comes from here. */
  summary() {
    const N = this.N;
    const times = [];
    let travel = 0, wait = 0, moved = 0;
    for (let i = 0; i < N; i++) {
      if (this.state[i] === STATE.EVACUATED) {
        times.push(this.exitT[i]);
        travel += this.exitT[i] - this.startT[i];
      }
      if (this.startT[i] >= 0) { wait += this.waitT[i]; moved++; }
    }
    times.sort((a, b) => a - b);
    const q = (p) => (times.length ? times[Math.min(times.length - 1, Math.ceil(p * N) - 1)] : null);
    const all = times.length === N && N > 0;
    const groups = this.c.groups.map((g) => {
      const passes = this.gatePasses[g.id];
      const bins = [];
      for (const t of passes) { const b = Math.floor(t / 5); bins[b] = (bins[b] || 0) + 1; }
      const peakFlow = bins.reduce((m, v) => Math.max(m, v || 0), 0) / 5;
      return {
        name: g.name, type: g.type, widthM: g.widthM, blocked: g.blocked,
        count: passes.length,
        share: N ? passes.length / N : 0,
        first: passes.length ? Math.round(passes[0] * 10) / 10 : null,
        last: passes.length ? Math.round(passes[passes.length - 1] * 10) / 10 : null,
        peakFlow: Math.round(peakFlow * 100) / 100,
        capacity: Math.round(g.widthM * MODEL.specificFlow * 100) / 100,
        cx: g.cx, cy: g.cy,
      };
    });
    const zones = this.scanBottlenecks(this.exposure, 3, 2);
    let personSecondsF = 0;
    for (let i = 0; i < N; i++) personSecondsF += this.waitT[i];
    const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
    return {
      layoutName: this.layout.name,
      modifications: [...(this.layout.modifications || [])],
      params: { ...this.params },
      occupants: N,
      evacuated: this.evacuated,
      trapped: N - this.evacuated,
      complete: all,
      rset: all ? round(times[N - 1]) : null,
      t50: round(q(0.5)),
      t95: round(q(0.95)),
      simulatedTime: round(this.t),
      meanTravel: round(times.length ? travel / times.length : 0),
      meanQueue: round(moved ? wait / moved : 0),
      peakDensity: { value: Math.round(this.peak.value * 100) / 100, x: this.peak.x, y: this.peak.y, t: round(this.peak.t), los: losFor(this.peak.value), label: describeLocation(this.c, this.peak.x, this.peak.y) },
      groups,
      bottlenecks: zones.slice(0, 6),
      curve: this.curve,
      grid: { w: this.c.w, h: this.c.h },
      profileStats: Array.isArray(this.params.profiles) && this.params.profiles.length ? this.profileStats() : null,
      // compact per-agent outcome for risk analysis: spawn point (m), exit time (s, -1 = not out), category
      agents: {
        sx: Array.from(this.spawnX.subarray(0, N), (v) => Math.round(v * 10) / 10),
        sy: Array.from(this.spawnY.subarray(0, N), (v) => Math.round(v * 10) / 10),
        t: Array.from(this.exitT.subarray(0, N), (v) => Math.round(v * 10) / 10),
        cat: Array.from(this.cat.subarray(0, N)),
      },
      exposure: Array.from(this.exposure, (v) => Math.round(v * 10) / 10),
      peakMap: Array.from(this.peakMap, (v) => Math.round(v * 100) / 100),
    };
  }
}

/** Expand configured population profiles into one entry per occupant. */
export function expandProfiles(profiles, N, rng) {
  const total = profiles.reduce((s, p) => s + (p.share || 0), 0) || 1;
  const out = [];
  let acc = 0;
  profiles.forEach((p, k) => {
    acc += (p.share || 0) / total;
    const target = k === profiles.length - 1 ? N : Math.round(acc * N);
    while (out.length < target) out.push({ ...p, id: p.id ?? k });
  });
  void rng;
  return out;
}

/** Spawn locations by area type (seats, hall standing, corridors, near entrances). */
export function spawnPools(c, layout, spawn, N, rng) {
  const { w, h, cells, passable, groups } = c;
  if (Array.isArray(spawn.custom)) {
    // explicit areas from Venue Studio: [{ cells, seated, count }]
    const areas = spawn.custom.map((a) => ({ seated: !!a.seated, left: a.count || 0, cells: rng.shuffle(a.cells.filter((x) => a.seated ? cells[x] === T.SEAT : passable[x])) }));
    const taken = new Set();
    const pop = (a) => { while (a.cells.length) { const x = a.cells.pop(); if (!taken.has(x)) { taken.add(x); return x; } } return -1; };
    return {
      take(kind) {
        for (const pass of [true, false])
          for (const a of areas) {
            if (kind === 'wheel' && a.seated) continue;
            if (pass && a.left <= 0) continue;
            const x = pop(a);
            if (x >= 0) { a.left--; return { cell: x, seated: a.seated ? 1 : 0 }; }
          }
        return { cell: -1, seated: 0 };
      },
    };
  }
  const hall = layout.meta?.hall || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  const inHall = (x, y) => x >= hall.x0 && x <= hall.x1 && y >= hall.y0 && y <= hall.y1;
  const corridors = [], entrances = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cells[i] !== T.FLOOR || !passable[i] || (x + y) % 2) continue;
      const nearOpening = groups.some((g) => Math.hypot(g.cx - (x + 0.5) * CELL, g.cy - (y + 0.5) * CELL) < 3);
      if (nearOpening) entrances.push(i);
      else if (!inHall(x, y)) corridors.push(i);
    }
  const pools = {
    seats: rng.shuffle([...c.seats]),
    standing: rng.shuffle([...c.standCells]),
    corridors: rng.shuffle(corridors),
    entrances: rng.shuffle(entrances),
  };
  const bays = (layout.meta?.wheelchairBays || []).filter((b) => passable[b]);
  const keys = ['seats', 'standing', 'corridors', 'entrances'];
  const tot = keys.reduce((s, k) => s + (spawn[k] || 0), 0) || 1;
  const quota = {};
  let used = 0;
  keys.forEach((k, idx) => { quota[k] = idx === keys.length - 1 ? N - used : Math.round(((spawn[k] || 0) / tot) * N); used += quota[k]; });
  const taken = new Set();
  const from = (k) => { const p = pools[k]; while (p.length) { const cell = p.pop(); if (!taken.has(cell)) { taken.add(cell); return cell; } } return -1; };
  let bi = 0;
  return {
    take(kind) {
      if (kind === 'wheel') {
        while (bi < bays.length) { const b = bays[bi++]; if (!taken.has(b)) { taken.add(b); return { cell: b, seated: 0 }; } }
        for (const k of ['standing', 'entrances', 'corridors']) { const cell = from(k); if (cell >= 0) return { cell, seated: 0 }; }
        return { cell: -1, seated: 0 };
      }
      // fill areas with remaining quota first, then overflow into any area with space
      for (const pass of [true, false]) {
        for (const k of keys) {
          if (pass && quota[k] <= 0) continue;
          const cell = from(k);
          if (cell >= 0) { quota[k]--; return { cell, seated: k === 'seats' ? 1 : 0 }; }
        }
      }
      return { cell: -1, seated: 0 };
    },
  };
}

export function runHeadless(layout, params, onProgress) {
  const sim = new Simulation(layout, params);
  return sim.runToEnd(onProgress);
}
