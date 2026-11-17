// Automatic bottleneck & risk analysis of a completed run.
// Every finding is derived from the run's measured result and the layout
// geometry. Findings are model estimates for comparing designs — not a
// verified safety assessment.
import { CELL, T, compile, describeLocation } from './layout.js';
import { distanceField } from './pathfinding.js';

const SEV = { high: 0, medium: 1, info: 2 };

export function analyzeRisk(layout, r, { travelLimit = 45 } = {}) {
  const c = compile(layout);
  const { w, h, n, passable, cells } = c;
  const out = [];
  const add = (f) => out.push(f);

  // 1. High-density zones
  r.bottlenecks.forEach((b, k) => {
    add({
      kind: 'density', severity: b.peak >= 4 ? 'high' : 'medium',
      title: `High density at ${b.label}`,
      detail: `Peak ${b.peak.toFixed(2)} p/m² over ${b.areaM2.toFixed(1)} m², ${b.exposure.toFixed(0)} cell·s above LOS F.`,
      x: b.x, y: b.y, radius: Math.max(1, Math.sqrt(b.areaM2 / Math.PI) + 0.5), ref: `B${k + 1}`,
    });
  });

  // 2. Congested exits — discharge close to capacity, with people queuing
  for (const g of r.groups) {
    if (g.blocked || !g.count) continue;
    const util = g.capacity ? g.peakFlow / g.capacity : 0;
    if (util >= 0.85 && g.count >= 10) {
      add({ kind: 'exit', severity: util >= 0.95 ? 'high' : 'medium', title: `${g.name} operating at capacity`, detail: `Peak discharge ${g.peakFlow.toFixed(2)} of ${g.capacity.toFixed(2)} p/s (${Math.min(100, Math.round(util * 100))} %), ${g.count} people (${Math.round(g.share * 100)} %).`, x: g.cx, y: g.cy, radius: 1.6, target: g.name });
    }
  }

  // 3. Blocked passages
  for (const g of c.groups) if (g.blocked) add({ kind: 'blocked', severity: 'medium', title: `${g.name} is closed`, detail: `${g.widthM.toFixed(1)} m of exit width unavailable in this scenario.`, x: g.cx, y: g.cy, radius: 1.4, target: g.name });
  for (const z of layout.meta?.hazards || []) {
    if (!z.cells?.length) continue;
    let sx = 0, sy = 0;
    for (const cell of z.cells) { sx += (cell % w) + 0.5; sy += Math.floor(cell / w) + 0.5; }
    add({ kind: 'blocked', severity: 'medium', title: `${z.label} closes ${(z.cells.length * CELL * CELL).toFixed(1)} m²`, detail: 'Occupants must route around this zone.', x: (sx / z.cells.length) * CELL, y: (sy / z.cells.length) * CELL, radius: 1.8 });
  }

  // 4. Narrow passages on used routes (clear width < 1.2 m, excluding seat rows and doors)
  // clear width at a cell = the shorter of its free horizontal and vertical runs
  const run = (i, step, lim) => { let k = 0, j = i; while (k < lim && passable[j]) { k++; j += step; } return k; };
  const widthAt = (i) => { const hz = run(i, 1, 12) + run(i, -1, 12) - 1; const vt = run(i, w, 12) + run(i, -w, 12) - 1; return Math.min(hz, vt) * CELL; };
  const nearSeat = (i) => cells[i - w] === T.SEAT || cells[i + w] === T.SEAT || cells[i - 1] === T.SEAT || cells[i + 1] === T.SEAT;
  const narrow = new Uint8Array(n);
  if (r.peakMap) for (let i = 0; i < n; i++) {
    if (!passable[i] || cells[i] !== T.FLOOR || nearSeat(i) || c.groupOf[i] >= 0) continue;
    const widthM = widthAt(i);
    if (r.peakMap[i] >= 1.5 && widthM < 1.2) narrow[i] = 1;
  }
  const seen = new Uint8Array(n);
  const narrowZones = [];
  for (let i = 0; i < n; i++) {
    if (!narrow[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; let cnt = 0, sx = 0, sy = 0, minW = 9;
    while (st.length) { const q = st.pop(); cnt++; sx += (q % w) + 0.5; sy += Math.floor(q / w) + 0.5; minW = Math.min(minW, widthAt(q)); for (const d of [1, -1, w, -w]) { const j = q + d; if (j >= 0 && j < n && narrow[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
    if (cnt >= 3) narrowZones.push({ cnt, x: (sx / cnt) * CELL, y: (sy / cnt) * CELL, minW });
  }
  narrowZones.sort((a, b) => b.cnt - a.cnt).slice(0, 3).forEach((z) => add({ kind: 'narrow', severity: 'medium', title: `Narrow passage at ${describeLocation(c, z.x, z.y)}`, detail: `Clear width about ${z.minW.toFixed(1)} m on a busy route (peak ≥ 1.5 p/m²), below the 1.2 m reference used here.`, x: z.x, y: z.y, radius: 1.3 }));

  // 5. Poorly distributed exits
  const exits = r.groups.filter((g) => g.type === 'exit' && !g.blocked);
  if (exits.length >= 2) {
    const tot = exits.reduce((s, g) => s + g.count, 0) || 1;
    const ideal = 1 / exits.length;
    const top = exits.slice().sort((a, b) => b.count - a.count)[0];
    const low = exits.slice().sort((a, b) => a.count - b.count)[0];
    const share = top.count / tot;
    if (share > ideal * 1.6) add({ kind: 'distribution', severity: share > ideal * 2.2 ? 'high' : 'medium', title: 'Exit use is unbalanced', detail: `${top.name} carries ${Math.round(share * 100)} % of occupants while ${low.name} carries ${Math.round((low.count / tot) * 100)} % (even split would be ${Math.round(ideal * 100)} %).`, x: top.cx, y: top.cy, radius: 1.6, target: top.name });
  }

  // 6. Inaccessible routes
  const a = r.agents;
  if (a) {
    const wheel = a.cat.map((k, i) => (k === 2 ? i : -1)).filter((i) => i >= 0);
    const stuck = wheel.filter((i) => a.t[i] < 0);
    if (stuck.length) add({ kind: 'access', severity: 'high', title: `${stuck.length} wheelchair user(s) could not reach an accessible exit`, detail: 'No step-free route reaches an exit marked accessible in this configuration.', x: a.sx[stuck[0]], y: a.sy[stuck[0]], radius: 1.4 });
    else if (wheel.length && r.rset) {
      const late = wheel.filter((i) => a.t[i] >= r.rset * 0.9);
      if (late.length) add({ kind: 'access', severity: 'medium', title: 'Wheelchair users are among the last out', detail: `${late.length} of ${wheel.length} wheelchair user(s) left in the final 10 % of the evacuation.`, x: a.sx[late[0]], y: a.sy[late[0]], radius: 1.4 });
    }
  }
  if (r.trapped > 0) add({ kind: 'access', severity: 'high', title: `${r.trapped} occupant(s) did not evacuate`, detail: 'They had no usable route to an open exit within the simulated time.', x: r.peakDensity.x, y: r.peakDensity.y, radius: 1.2 });

  // 7. Long evacuation paths (uncongested walking distance from where people started)
  const open = c.exits.flatMap((g) => g.cells);
  if (open.length && a) {
    const f = distanceField(c, open, null, null);
    let worst = 0, wi = -1;
    for (let i = 0; i < a.sx.length; i++) {
      const cell = Math.floor(a.sy[i] / CELL) * w + Math.floor(a.sx[i] / CELL);
      let d = f[cell];
      if (!isFinite(d)) for (const dd of [w, -w, 1, -1]) if (isFinite(f[cell + dd])) d = Math.min(isFinite(d) ? d : 1e9, f[cell + dd]);
      if (isFinite(d) && d > worst) { worst = d; wi = i; }
    }
    if (wi >= 0 && worst > travelLimit) add({ kind: 'distance', severity: 'medium', title: `Long travel distance (${worst.toFixed(0)} m)`, detail: `Longest walking route to an exit exceeds ${travelLimit} m. Check the permitted travel distance for your occupancy class in NBC 2016 Part 4.`, x: a.sx[wi], y: a.sy[wi], radius: 1.4 });
    else if (wi >= 0) add({ kind: 'distance', severity: 'info', title: `Longest travel distance ${worst.toFixed(0)} m`, detail: `Within the ${travelLimit} m reference used here; verify against NBC 2016 Part 4 for your occupancy.`, x: a.sx[wi], y: a.sy[wi], radius: 1.2 });
  }

  // 8. Areas with delayed evacuation (3 m bins, mean exit time of people starting there)
  if (a && r.rset) {
    const B = 6; // cells per bin = 3 m
    const bins = new Map();
    for (let i = 0; i < a.sx.length; i++) {
      if (a.t[i] < 0) continue;
      const k = `${Math.floor(a.sx[i] / (B * CELL))},${Math.floor(a.sy[i] / (B * CELL))}`;
      const b = bins.get(k) || { n: 0, t: 0, x: 0, y: 0 };
      b.n++; b.t += a.t[i]; b.x += a.sx[i]; b.y += a.sy[i];
      bins.set(k, b);
    }
    const list = [...bins.values()].filter((b) => b.n >= 4).map((b) => ({ ...b, mean: b.t / b.n }));
    const overall = list.reduce((s, b) => s + b.t, 0) / Math.max(1, list.reduce((s, b) => s + b.n, 0));
    list.sort((p, q) => q.mean - p.mean);
    const worst = list[0];
    if (worst && worst.mean > overall * 1.35) add({ kind: 'delay', severity: 'medium', title: `Delayed area: ${describeLocation(c, worst.x / worst.n, worst.y / worst.n)}`, detail: `${worst.n} people starting here leave after ${worst.mean.toFixed(0)} s on average, versus ${overall.toFixed(0)} s overall.`, x: worst.x / worst.n, y: worst.y / worst.n, radius: 1.5 * CELL * 6 / 2 });
  }

  const seenT = new Set();
  const uniq = out.filter((f) => !seenT.has(f.title) && seenT.add(f.title));
  uniq.sort((p, q) => SEV[p.severity] - SEV[q.severity]);
  return uniq.map((f, i) => ({ ...f, id: i }));
}

export const RISK_NOTE = 'Findings are model estimates from this simulation, intended for comparing design options. They are not a verified fire-safety assessment or building certification.';
