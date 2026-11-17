import { CELL } from './layout.js';

// Multi-source Dijkstra on an 8-connected grid ("distance field" / floor field).
// Every passable cell gets the cost-weighted distance (in metres) to the nearest
// target cell. Agents walk down this field's gradient. Diagonal moves are only
// allowed when both orthogonal neighbours are open (no squeezing past corners).

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

class MinHeap {
  constructor(cap) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.size = 0;
  }
  push(key, val) {
    if (this.size >= this.k.length) {
      const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v;
    }
    let i = this.size++;
    const { k, v } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const { k, v } = this;
    const topV = v[0];
    this.topK = k[0];
    const lastK = k[--this.size];
    const lastV = v[this.size];
    let i = 0;
    const n = this.size;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lastK) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = lastK; v[i] = lastV;
    return topV;
  }
}

/** Per-cell traversal multiplier: cells hugging walls/furniture cost a little more,
 *  which keeps routes centred in aisles instead of scraping along walls. */
export function wallPenalty(compiled) {
  const { w, h, passable } = compiled;
  const pen = new Float32Array(w * h).fill(1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!passable[i]) continue;
      let near = 0;
      for (let d = 0; d < 8; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !passable[yy * w + xx]) { near = 1; break; }
      }
      pen[i] = near ? 1.25 : 1;
    }
  return pen;
}

/**
 * @param compiled   compiled layout
 * @param targets    array of cell indices (distance 0)
 * @param mult       optional Float32Array per-cell cost multiplier (congestion)
 * @param penalty    wall penalty from wallPenalty()
 * @param out        optional output Float32Array to reuse
 */
export function distanceField(compiled, targets, mult, penalty, out) {
  const { w, h, passable } = compiled;
  const n = w * h;
  const dist = out || new Float32Array(n);
  dist.fill(Infinity);
  const heap = new MinHeap(1024);
  for (const t of targets) {
    if (!passable[t]) continue;
    dist[t] = 0;
    heap.push(0, t);
  }
  while (heap.size) {
    const c = heap.pop();
    const dc = heap.topK;
    if (dc > dist[c] + 1e-4) continue;
    const x = c % w;
    const y = (c - x) / w;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!passable[j]) continue;
      if (d >= 4 && (!passable[y * w + xx] || !passable[yy * w + x])) continue;
      let step = (d < 4 ? CELL : CELL * SQRT2) * (penalty ? penalty[j] : 1);
      if (mult) step *= mult[j];
      const nd = dc + step;
      if (nd < dist[j]) {
        dist[j] = nd;
        heap.push(nd, j);
      }
    }
  }
  return dist;
}

/** Returns the visited order of a plain Dijkstra from one source — used by the
 *  educational demo to animate the expanding wavefront. */
export function dijkstraTrace(w, h, open, source, goal) {
  const n = w * h;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const order = [];
  const heap = new MinHeap(256);
  dist[source] = 0;
  heap.push(0, source);
  while (heap.size) {
    const c = heap.pop();
    const dc = heap.topK;
    if (dc > dist[c] + 1e-4) continue;
    order.push(c);
    if (c === goal) break;
    const x = c % w, y = (c - x) / w;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!open[j]) continue;
      if (d >= 4 && (!open[y * w + xx] || !open[yy * w + x])) continue;
      const nd = dc + (d < 4 ? 1 : SQRT2);
      if (nd < dist[j]) { dist[j] = nd; prev[j] = c; heap.push(nd, j); }
    }
  }
  const path = [];
  if (dist[goal] < Infinity) for (let c = goal; c !== -1; c = prev[c]) path.unshift(c);
  return { order, path, dist };
}

export { DX, DY };
