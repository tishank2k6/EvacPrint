// Builds the live application context the assistant is grounded in.
// Everything here is read from real app state — nothing is estimated.
import { controller as ctl } from '../sim/controller.js';
import { losFor } from '../sim/engine.js';

/** shared page state the assistant can see (set by pages that own data) */
export const appState = { venue: null };

const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);

export function snapshot() {
  const s = ctl.sim;
  const c = s.c;
  let waiting = 0, moving = 0, congested = 0;
  for (let i = 0; i < s.N; i++) { const st = s.state[i]; if (st === 0) waiting++; else if (st === 1) { moving++; if (s.congested[i]) congested++; } }
  const openings = c.groups.map((g) => {
    let front = 0;
    for (const cell of s.gateFront[g.id]) front = Math.max(front, s.densityEMA[cell]);
    return { name: g.name, kind: g.type === 'exit' ? 'final exit' : 'hall door', width_m: g.widthM, blocked: g.blocked, people_through: s.gatePasses[g.id].length, queue_now: s.gateQueue[g.id], density_in_front_p_m2: r2(front), capacity_p_s: r2(g.widthM * 1.33), x_m: r1(g.cx), y_m: r1(g.cy) };
  });
  const ctx = {
    page: location.hash.replace(/^#/, '') || '/',
    venue: ctl.venue ? { name: ctl.venue.name, source: 'Venue Studio', dimensions_verified: !!ctl.venue.scaleVerified, emergency: ctl.venue.config?.emergency?.type, population: ctl.venue.config?.population?.total, age: ctl.venue.config?.age, mobility: ctl.venue.config?.mobility } : { name: ctl.layout.name, source: 'built-in model (dimensions to be verified on site)', size_m: '21 × 15 hall + corridors' },
    scenario: ctl.scenarioId,
    layout_changes: ctl.layout.modifications,
    parameters: { occupants: s.N, reaction_s: [ctl.params.reactionMin, ctl.params.reactionMax], panic: ctl.params.panic, reduced_mobility_share: ctl.params.slowFraction, wheelchairs: ctl.params.wheelchairs, seed: ctl.params.seed },
    simulation: {
      status: s.done ? 'complete' : s.t === 0 ? 'not started' : ctl.running ? 'running' : 'paused',
      phase: ctl.phase,
      time_s: r1(s.t),
      evacuated: s.evacuated, still_inside: s.N - s.evacuated, reacting: waiting, moving, congested_now: congested,
      peak_density_so_far: { value: r2(s.peak.value), los: losFor(s.peak.value), x_m: r1(s.peak.x), y_m: r1(s.peak.y), at_s: r1(s.peak.t) },
      live_bottlenecks: s.liveBottlenecks.slice(0, 4).map((b, k) => ({ id: `B${k + 1}`, where: b.label, area_m2: r1(b.areaM2), peak: r2(b.peak), x_m: r1(b.x), y_m: r1(b.y) })),
    },
    openings,
  };
  const r = ctl.result;
  if (r) ctx.last_completed_run = {
    rset_s: r.rset, t95_s: r.t95, t50_s: r.t50, complete: r.complete, not_evacuated: r.trapped, mean_queue_s: r.meanQueue, mean_walk_s: r.meanTravel,
    peak_density: { value: r.peakDensity.value, los: r.peakDensity.los, where: r.peakDensity.label },
    bottlenecks: r.bottlenecks.slice(0, 4).map((b, k) => ({ id: `B${k + 1}`, where: b.label, peak: b.peak, exposure_cell_s: b.exposure })),
    exit_use: r.groups.map((g) => ({ name: g.name, people: g.count, share: r2(g.share), peak_flow_p_s: g.peakFlow, capacity_p_s: g.capacity, blocked: g.blocked })),
    risk_findings: (r.risk || []).map((f, i) => ({ n: i + 1, severity: f.severity, title: f.title, detail: f.detail })),
  };
  const p = ctl.previous;
  if (p && p.rset != null) ctx.previous_run = { rset_s: p.rset, occupants: p.occupants, scenario: p.scenarioId, changes: p.modifications, peak: p.peakDensity.value };
  if (ctl.recs?.status === 'done') ctx.recommendations = { baseline_mean_rset_s: ctl.recs.baseline.meanRset, items: ctl.recs.items.slice(0, 8).map((it) => ({ change: it.title, mean_saved_s: it.saved, range_s: [it.savedMin, it.savedMax], consistent: it.significant, peak_density_change: it.peakDelta, complete: it.complete })) };
  else if (ctl.recs?.status === 'running') ctx.recommendations = { status: 'running', done: ctl.recs.done, total: ctl.recs.total };
  if (ctl.compare) ctx.before_after = { change: ctl.compare.title, before_rset_s: ctl.compare.before.result.rset, after_rset_s: ctl.compare.after.result.rset };
  if (appState.venue) {
    const v = appState.venue;
    ctx.open_venue_in_studio = { name: v.name, elements: v.plan.shapes.length, dimensions_verified: v.plan.scaleVerified, population: v.config.population.total, emergency: v.config.emergency.type, saved_runs: v.runs.length, last_run_rset_s: v.runs.at(-1)?.rsets?.[0] ?? null };
  }
  return ctx;
}

export const contextBlock = () => `<app_context captured="${new Date().toISOString()}">\n${JSON.stringify(snapshot())}\n</app_context>`;
