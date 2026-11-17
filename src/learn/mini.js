// Small rooms for explainers and labs, plus a recorder that captures a real
// engine run into scrubbable frames.
import { T, CELL, compile } from '../sim/layout.js';
import { Simulation, STATE } from '../sim/engine.js';

/**
 * @param w,h        grid size in cells (0.5 m)
 * @param openings   [{ side: 'n'|'s'|'e'|'w', at, width, name, type: 'exit'|'door', x? }]
 * @param spawn      {x0,y0,x1,y1} cells where occupants start
 * @param partitions [{ x, y0, y1 }] internal vertical walls (openings with side 'p' cut through them)
 */
export function miniRoom({ w = 32, h = 20, openings = [], spawn, partitions = [], obstacles = [] }) {
  const cells = new Uint8Array(w * h);
  const id = (x, y) => y * w + x;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) cells[id(x, y)] = x === 1 || y === 1 || x === w - 2 || y === h - 2 ? T.WALL : T.FLOOR;
  for (const p of partitions) for (let y = p.y0; y <= p.y1; y++) cells[id(p.x, y)] = T.WALL;
  for (const [x, y] of obstacles) cells[id(x, y)] = T.OBST;
  const labels = {};
  for (const o of openings) {
    const t = o.type === 'door' ? T.DOOR : T.EXIT;
    for (let k = 0; k < o.width; k++) {
      let x, y;
      if (o.side === 'e') { x = w - 2; y = o.at + k; }
      else if (o.side === 'w') { x = 1; y = o.at + k; }
      else if (o.side === 'n') { x = o.at + k; y = 1; }
      else if (o.side === 's') { x = o.at + k; y = h - 2; }
      else { x = o.x; y = o.at + k; } // through a partition
      cells[id(x, y)] = t;
      labels[id(x, y)] = o.name;
    }
  }
  return {
    name: 'Demo room', w, h, cells, labels, blocked: [], modifications: [],
    meta: { hall: spawn || { x0: 2, y0: 2, x1: w - 3, y1: h - 3 }, regions: [], designOptions: [], wheelchairBays: [] },
  };
}

/** Run a simulation to completion and keep a frame every `every` seconds. */
export function recordRun(layout, params, { every = 0.2, maxT = 240 } = {}) {
  const sim = new Simulation(layout, { maxTime: maxT, ...params });
  const frames = [];
  const N = sim.N;
  const snap = () => {
    const xs = new Float32Array(N), ys = new Float32Array(N), st = new Uint8Array(N), sp = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      xs[i] = sim.x[i]; ys[i] = sim.y[i];
      const s = sim.state[i];
      st[i] = s === STATE.EVACUATED ? 3 : s === STATE.WAITING ? 0 : sim.congested[i] ? 2 : 1;
      sp[i] = Math.hypot(sim.vx[i], sim.vy[i]);
    }
    frames.push({ t: sim.t, out: sim.evacuated, xs, ys, st, sp, heat: Float32Array.from(sim.densityEMA), peak: sim.currentPeak || 0 });
  };
  snap();
  let next = every;
  while (!sim.done) {
    sim.step();
    if (sim.t + 1e-9 >= next) { snap(); next += every; }
  }
  snap();
  return { frames, sim, compiled: sim.c, N, duration: sim.t, result: sim.summary(), cat: Uint8Array.from(sim.cat), r: Float32Array.from(sim.r), react: Float32Array.from(sim.react), v0: Float32Array.from(sim.v0) };
}

export function frameAt(rec, simT) {
  const k = Math.max(0, Math.min(rec.frames.length - 1, Math.round(simT / 0.2)));
  return rec.frames[k];
}

export { CELL, compile };
