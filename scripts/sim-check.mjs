// Headless verification of the simulation engine: runs all four scenarios,
// checks that every occupant gets out, and reports timings.
import { createHall406, cloneLayout, generateCandidates } from '../src/sim/layout.js';
import { runHeadless } from '../src/sim/engine.js';
import { SCENARIOS } from '../src/sim/scenarios.js';

const base = createHall406();
let failed = false;
const rows = [];
for (const sc of SCENARIOS) {
  const layout = cloneLayout(base);
  layout.blocked = [...sc.blocked];
  const t0 = performance.now();
  const r = runHeadless(layout, { ...sc.params, seed: 406 });
  const ms = performance.now() - t0;
  rows.push({
    scenario: sc.name,
    N: r.occupants,
    out: r.evacuated,
    rset: r.rset,
    t95: r.t95,
    peak: r.peakDensity.value + ' (' + r.peakDensity.los + ')',
    worst: r.bottlenecks[0]?.label ?? '-',
    doors: r.groups.map((g) => `${g.name}:${g.count}`).join(' '),
    ms: Math.round(ms),
  });
  if (!r.complete) failed = true;
}
console.table(rows);

if (process.argv.includes('--recommend')) {
  for (const id of ['blocked', 'normal']) {
    const sc = SCENARIOS.find((s) => s.id === id);
    const layout = cloneLayout(base);
    layout.blocked = [...sc.blocked];
    const seeds = [406, 407, 408];
    const mean = (l) => seeds.map((s) => runHeadless(l, { ...sc.params, seed: s })).reduce((a, r) => a + (r.rset ?? 600), 0) / seeds.length;
    const b = mean(layout);
    console.log(`\n${sc.name}: baseline mean RSET ${b.toFixed(1)} s`);
    for (const c of generateCandidates(layout)) {
      const t0 = performance.now();
      const m = mean(c.layout);
      console.log(`  ${(b - m).toFixed(1).padStart(6)} s  ${c.title}  (${Math.round(performance.now() - t0)} ms)`);
    }
  }
}
process.exit(failed ? 1 : 0);
