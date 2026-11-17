// Client-side executors for EvacPrint AI tools. Read-only tools run directly;
// state-changing tools are only run after the user confirms them in the panel.
import { controller as ctl } from '../sim/controller.js';
import { cloneLayout, widenOpening, createHall406 } from '../sim/layout.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { runBatch } from '../sim/batch.js';
import { snapshot } from './context.js';
import { saveReport, liteRec } from '../reports/store.js';

export const CONFIRM = new Set(['set_scenario', 'run_simulation', 'set_exit_blocked', 'set_occupancy', 'what_if', 'compare_scenarios', 'run_recommendations', 'generate_report']);
const SC = ['normal', 'blocked', 'large', 'mixed'];
const openingNames = () => ctl.sim.c.groups.map((g) => g.name);
const findOpening = (name) => ctl.sim.c.groups.find((g) => g.name.toLowerCase() === String(name || '').toLowerCase().trim()) || ctl.sim.c.groups.find((g) => g.name.toLowerCase().replace(/^(door|exit)\s+/, '') === String(name || '').toLowerCase().replace(/^(door|exit)\s+/, '').trim());

/** Validate input against the tool's expectations; returns an error string or null. */
export function validateInput(name, a) {
  if (!a || typeof a !== 'object') return 'input must be an object';
  switch (name) {
    case 'set_scenario': return SC.includes(a.scenario) ? null : `scenario must be one of ${SC.join(', ')}`;
    case 'compare_scenarios': return SC.includes(a.a) && SC.includes(a.b) ? null : `a and b must be among ${SC.join(', ')}`;
    case 'set_exit_blocked': return findOpening(a.exit) && typeof a.blocked === 'boolean' ? null : `exit must be one of: ${openingNames().join(', ')}; blocked must be boolean`;
    case 'set_occupancy': return Number.isInteger(a.count) && a.count >= 1 && a.count <= 1500 ? null : 'count must be an integer 1–1500';
    case 'run_simulation': return a.speed == null || [1, 2, 4, 8].includes(a.speed) ? null : 'speed must be 1, 2, 4 or 8';
    case 'highlight_area': return typeof a.label === 'string' ? null : 'label is required';
    case 'navigate': return ['overview', 'simulator', '3d', 'venues', 'how-it-works', 'technology', 'learn', 'reports'].includes(a.page) ? null : 'unknown page';
    case 'what_if': {
      if (typeof a.description !== 'string') return 'description is required';
      for (const n of [...(a.block_exits || []), ...(a.open_exits || []), ...(a.widen_exit ? [a.widen_exit] : [])]) if (!findOpening(n)) return `unknown opening "${n}". Known: ${openingNames().join(', ')}`;
      if (a.occupants != null && !(Number.isInteger(a.occupants) && a.occupants > 0 && a.occupants <= 1500)) return 'occupants must be 1–1500';
      if (a.slow_fraction != null && !(a.slow_fraction >= 0 && a.slow_fraction <= 0.6)) return 'slow_fraction must be 0–0.6';
      if (a.panic != null && !(a.panic >= 0 && a.panic <= 1)) return 'panic must be 0–1';
      return null;
    }
    default: return null;
  }
}

/** Human description shown on the confirmation card. */
export function describe(name, a) {
  switch (name) {
    case 'set_scenario': return `Switch the live simulator to the “${SCENARIOS.find((s) => s.id === a.scenario)?.name}” scenario and reset it.`;
    case 'run_simulation': return `Reset and run the live simulation${a.speed ? ` at ${a.speed}×` : ''} with the current settings.`;
    case 'set_exit_blocked': return `${a.blocked ? 'Block' : 'Reopen'} ${findOpening(a.exit)?.name} in the live layout (the run resets).`;
    case 'set_occupancy': return `Set the live simulation to ${a.count} occupants (the run resets).`;
    case 'what_if': return `Test on a copy, without changing your layout: ${a.description}. Runs the baseline and the modified copy with the same seed.`;
    case 'compare_scenarios': return `Run “${a.a}” and “${a.b}” headless with the same seed and compare them.`;
    case 'run_recommendations': return 'Run the recommendation engine (every applicable design change × 3 seeds).';
    case 'generate_report': return 'Save a report of the last completed run and open it.';
    default: return name;
  }
}

const lite = (r) => ({ rset_s: r.rset, t95_s: r.t95, complete: r.complete, not_evacuated: r.trapped, peak_density: r.peakDensity.value, peak_where: r.peakDensity.label, mean_queue_s: r.meanQueue, worst_bottleneck: r.bottlenecks[0]?.label || null, exit_use: Object.fromEntries(r.groups.map((g) => [g.name, g.blocked ? 'blocked' : g.count])) });

export async function execute(name, a, { navigate, openLearning }) {
  switch (name) {
    case 'get_simulation_snapshot': return snapshot();
    case 'highlight_area': {
      const s = ctl.sim;
      let x = a.x, y = a.y, radius = 1.6;
      const t = String(a.target || '').trim();
      const g = t && findOpening(t);
      const bm = /^b\s*(\d)$/i.exec(t);
      const rm = /^risk\s*(\d+)$/i.exec(t);
      if (g) { x = g.cx; y = g.cy; }
      else if (bm) { const b = (s.done && ctl.result ? ctl.result.bottlenecks : s.liveBottlenecks)[+bm[1] - 1]; if (b) { x = b.x; y = b.y; radius = Math.max(1.2, Math.sqrt(b.areaM2 / Math.PI) + 0.5); } }
      else if (rm) { const f = ctl.result?.risk?.[+rm[1] - 1]; if (f) { x = f.x; y = f.y; radius = f.radius || 1.5; } }
      if (x == null || y == null) return { ok: false, error: `Could not locate "${t}". Openings: ${openingNames().join(', ')}` };
      ctl.highlight({ x, y, radius, label: a.label });
      if (!/^\/(simulator|3d)/.test(location.hash.slice(1))) return { ok: true, note: 'Highlighted on the simulator and 3D views (not the current page).' };
      return { ok: true, x_m: Math.round(x * 10) / 10, y_m: Math.round(y * 10) / 10 };
    }
    case 'navigate': navigate(a.page); return { ok: true, page: a.page };
    case 'open_learning': openLearning(a.topic); return { ok: true };
    case 'set_scenario': ctl.setScenario(a.scenario); navigate('simulator'); return { ok: true, scenario: a.scenario, occupants: ctl.sim.N, blocked: ctl.layout.blocked };
    case 'run_simulation': ctl.reset(); if (a.speed) ctl.setSpeed(a.speed); ctl.play(); navigate('simulator'); return { ok: true, started: true, occupants: ctl.sim.N, note: 'Running live; ask again later for results or use get_simulation_snapshot.' };
    case 'set_exit_blocked': { const g = findOpening(a.exit); if (g.blocked !== a.blocked) ctl.toggleBlocked(g.name); return { ok: true, exit: g.name, blocked: a.blocked, now_blocked: ctl.layout.blocked }; }
    case 'set_occupancy': ctl.setParams({ occupants: a.count }); return { ok: true, occupants: ctl.sim.N, note: ctl.sim.N < a.count ? `Only ${ctl.sim.N} fit in the available seats and standing areas.` : undefined };
    case 'what_if': {
      const base = cloneLayout(ctl.layout);
      let mod = cloneLayout(ctl.layout);
      const notes = [];
      for (const n of a.block_exits || []) { const g = findOpening(n); if (!mod.blocked.includes(g.name)) mod.blocked.push(g.name); }
      for (const n of a.open_exits || []) { const g = findOpening(n); mod.blocked = mod.blocked.filter((b) => b !== g.name); }
      if (a.widen_exit) { const g = findOpening(a.widen_exit); const w = widenOpening(mod, g.name, 2); if (w) mod = w; else notes.push(`${g.name} could not be widened: the adjacent wall cells do not allow it.`); }
      const p0 = { ...ctl.params };
      const p1 = { ...p0, ...(a.occupants ? { occupants: a.occupants } : {}), ...(a.slow_fraction != null ? { slowFraction: a.slow_fraction } : {}), ...(a.panic != null ? { panic: a.panic } : {}) };
      const [r0, r1] = await runBatch([{ layout: base, params: p0, full: false }, { layout: mod, params: p1, full: false }]);
      return { ok: true, change: a.description, copy_only: true, baseline: lite(r0), modified: lite(r1), rset_change_s: r0.rset != null && r1.rset != null ? Math.round((r1.rset - r0.rset) * 10) / 10 : null, seed: p0.seed, notes };
    }
    case 'compare_scenarios': {
      const mk = (id) => { const sc = SCENARIOS.find((s) => s.id === id); const l = cloneLayout(createHall406()); l.blocked = [...sc.blocked]; return { layout: l, params: { ...sc.params, seed: 406 }, full: false }; };
      const [ra, rb] = await runBatch([mk(a.a), mk(a.b)]);
      return { ok: true, seed: 406, venue: 'Seminar Hall 406', [a.a]: lite(ra), [a.b]: lite(rb) };
    }
    case 'run_recommendations': {
      const r = await ctl.recommend();
      if (r.status !== 'done') return { ok: false, error: r.message || 'Recommendation run failed' };
      return { ok: true, runs: r.runs, baseline_mean_rset_s: r.baseline.meanRset, ranked: r.items.map((it) => ({ change: it.title, mean_saved_s: it.saved, range_s: [it.savedMin, it.savedMax], consistent: it.significant, peak_density_change: it.peakDelta, complete: it.complete, tradeoff: it.tradeoff })) };
    }
    case 'generate_report': {
      const res = ctl.result;
      if (!res) return { ok: false, error: 'No completed run yet — run the simulation to completion first.' };
      const sc = SCENARIOS.find((s) => s.id === ctl.scenarioId) || { id: 'custom', name: 'Custom scenario' };
      const rep = saveReport({ title: `${res.layoutName} — ${sc.name}`, scenario: sc.name, scenarioId: sc.id, result: res, recs: ctl.recs?.status === 'done' ? { baseline: ctl.recs.baseline.meanRset, items: ctl.recs.items.map(liteRec), runs: ctl.recs.runs } : null, compare: ctl.compare, venue: ctl.venue ? { ...ctl.venue, risk: res.risk, profiles: res.profileStats } : null });
      location.hash = `/reports/${rep.id}`;
      return { ok: true, report_id: rep.id, rset_s: res.rset };
    }
    default: return { ok: false, error: `Unknown tool ${name}` };
  }
}
