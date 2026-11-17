// Offline guide — used when no AI model is connected. It is NOT an AI: it
// matches a fixed set of intents, answers from live simulation data and the
// knowledge base below, and proposes the same confirmed actions.
import { snapshot } from './context.js';
import { controller as ctl } from '../sim/controller.js';

const KB = {
  'evac-sim': { k: /evacuation simulation|how .*evacprint work|what is evacprint|simulat(e|ion) work/, t: 'Evacuation simulation', lab: 'evac-sim',
    beginner: 'An evacuation simulation is a virtual fire drill. EvacPrint draws the room, places virtual people in it, sounds an alarm, and lets each person walk to the nearest exit. It times how long the last person takes to get out and shows where crowds jam.',
    intermediate: 'EvacPrint turns the floor plan into a 0.5 m grid, computes the walking distance from every cell to every exit (Dijkstra), then moves each occupant in 0.1 s steps: they react after a personal delay, walk toward their best exit, slow down in dense crowds and queue at doors that pass at most 1.33 people per second per metre. The output is the evacuation time (RSET), exit use, density maps and bottlenecks.',
    advanced: 'Agents move in continuous space over a 0.5 m navigation grid. Route choice uses per-exit multi-source Dijkstra fields (8-connected, wall penalty ×1.25) refreshed every 2 s with cost ×(1 + 0.45ρ). Desired velocity follows the interpolated field gradient with Weidmann speed v = v0[1 − e^(−1.913(1/ρ − 1/5.4))], first-order relaxation τ = 0.5 s and position-based collision. Openings are token-bucket gates at 1.33 p/s/m (SFPE), with a panic-dependent clogging factor. Density is a Gaussian kernel with R = 0.7 m.' },
  twin: { k: /digital twin/, t: 'Digital twins', lab: 'twin',
    beginner: 'A digital twin is a virtual copy of a real place that you can test safely. EvacPrint builds a copy of the venue so you can try emergencies on the copy instead of on real people.',
    intermediate: 'A digital twin is a model kept in step with a real asset. EvacPrint’s model is built from the measured layout plus a live occupancy count; sensor feeds such as entry counters are future scope, so today it is best described as a planning twin.',
    advanced: 'Strictly, a twin needs a data link from the physical asset. EvacPrint has geometry (measured or calibrated plans) and a manually entered occupancy state; bidirectional sync (counters/CCTV in, recommendations out) is the roadmap. Results are comparative until calibrated against a timed drill.' },
  grid: { k: /grid|floor ?plan.*(convert|turn)|rasteri/, t: 'Floor plan to grid', lab: 'lab-dijkstra',
    beginner: 'The floor plan is cut into small 50 cm squares, like graph paper. Each square is marked as wall, floor, seat, door or exit.',
    intermediate: 'Each 0.5 m cell gets a type. Walls, seats, stage and furniture block movement; doors and exits are walkable but flow-limited. Routing and density are computed on this grid.',
    advanced: '0.5 m resolution resolves 1 m aisles and 0.5 m seat rows. Openings are 4-connected components of door/exit cells; capacity = clear width × specific flow. Agents themselves are continuous; the grid serves routing, collision lookup and density binning.' },
  dijkstra: { k: /dijkstra|bfs|shortest path|pathfind/, t: 'Dijkstra and BFS', lab: 'dijkstra',
    beginner: 'Imagine pouring water at the exit: it spreads out step by step and reaches near places first. Each square remembers how many steps the water needed. People simply walk toward squares with smaller numbers.',
    intermediate: 'BFS spreads from the exit in equal steps; Dijkstra does the same but with real costs, so diagonal steps cost √2. Run once from each exit, it gives every cell its distance to safety. Example: a cell 6 straight and 2 diagonal steps away has cost 6 + 2×1.41 = 8.83 cells, i.e. 4.4 m.',
    advanced: 'Multi-source Dijkstra with a binary heap, O(n log n) per exit field, no corner cutting. EvacPrint adds a wall-proximity penalty and a dynamic congestion multiplier (1 + 0.45ρ) every 2 s, producing a dynamic floor field. Agents use the bilinearly interpolated gradient.' },
  abm: { k: /agent.?based|agents?\b.*(model|work)|abm/, t: 'Agent-based modelling', lab: 'abm',
    beginner: 'Every person is simulated separately, with their own speed and reaction time. Crowd behaviour appears from all of them following simple rules.',
    intermediate: 'Each agent has a free speed, body radius, reaction time and profile (adult, reduced mobility, wheelchair, and Venue Studio age groups). States: waiting → walking → queuing → evacuated. Queues and lanes emerge rather than being scripted.',
    advanced: 'Heterogeneous agents with sampled v0 ~ N(1.34, 0.15) m/s clipped to 1.0–1.6, profile-specific ranges, reaction times from a triangular distribution, and per-agent exit choice with hysteresis. Interaction is via density-dependent speed and position-based collision, not explicit social forces.' },
  density: { k: /density|people per square|crowd.*(slow|speed)|per m|square metre|heat ?map/, t: 'Crowd density', lab: 'density',
    beginner: 'Density means how many people stand in one square metre. At 1 person per m² you walk normally; at 4 or more you are squeezed and can barely move.',
    intermediate: 'EvacPrint counts nearby people with a smoothing kernel and divides by area. Colours follow Fruin’s levels of service: green below 1.08, yellow to 2.15, orange to 4, red above 4 p/m². Walking speed falls with density: about 1.0 m/s at 1 p/m², 0.6 m/s at 2 p/m².',
    advanced: 'ρ(x) = Σ exp(−|xᵢ − x|²/R²)/(πR²), R = 0.7 m (Helbing et al. 2007), smoothed with a 1 s EMA for display. Speed uses Weidmann (1993). Bottlenecks are 8-connected components of cells ≥ 2.15 p/m² sustained ≥ 3 s, ranked by exposure × peak.' },
  bottleneck: { k: /bottleneck|why .*(stuck|jam|queue)|queue/, t: 'Bottlenecks', lab: 'bottleneck',
    beginner: 'A bottleneck is like the neck of a bottle: a door that lets only a few people through at a time. When more people arrive than it can pass, a queue builds up.',
    intermediate: 'A 1 m door passes about 1.33 people per second. If 3 people per second arrive, about 1.7 people per second join the queue, and the queue forms an arch in front of the door.',
    advanced: 'Gate discharge is capped at 1.33 p/s/m clear width; arrival rate above capacity accumulates as a queue whose density saturates near 5–6 p/m². The evacuation becomes capacity-limited: RSET ≈ pre-movement + N_door / (1.33 × width).' },
  width: { k: /door width|wider|widen/, t: 'Door width', lab: 'width',
    beginner: 'A wider door lets more people through at once, so the queue drains faster.',
    intermediate: 'Capacity grows roughly in proportion to clear width: 1.0 m ≈ 1.33 p/s, 2.0 m ≈ 2.66 p/s. Widening only helps if that door is actually the bottleneck.',
    advanced: 'Specific flow 1.33 p/s/m is an SFPE planning value; real effective width subtracts boundary layers. EvacPrint widens the opening in the grid and re-runs the whole evacuation on 3 seeds to measure the real gain, including rerouting effects.' },
  premove: { k: /pre.?movement|reaction time|react/, t: 'Pre-movement time',
    beginner: 'People don’t run the moment an alarm rings. They finish a sentence, look around, pick up a bag. That delay is the pre-movement time.',
    intermediate: 'Drills typically show 10–60 s of pre-movement. EvacPrint draws each person’s delay from the range you set (default 10–30 s); staff react faster, hearing-impaired people later without a visual alarm.',
    advanced: 'Pre-movement often dominates RSET in well-designed buildings. EvacPrint samples a triangular distribution between min and max, scaled by profile and panic (×(1 − 0.35·panic)), plus detection and alarm delays from Venue Studio.' },
  rset: { k: /rset|evacuation time|what does .*time (mean|represent)|aset/, t: 'Evacuation time (RSET)',
    beginner: 'The evacuation time is how long it takes until the very last person is outside.',
    intermediate: 'RSET (Required Safe Egress Time) = time the last person leaves. A safe design needs RSET below ASET, the time before conditions become dangerous. EvacPrint computes RSET; ASET needs fire modelling, which it does not do.',
    advanced: 'RSET = detection + alarm + pre-movement + movement (walking + queuing). EvacPrint reports T100 (RSET), T95 and T50 per run and the spread across seeds; ASET requires a fire/smoke model (out of scope).' },
  access: { k: /accessib|wheelchair|disab|mobility/, t: 'Accessibility',
    beginner: 'People using wheelchairs or walking aids move more slowly and need wider space. If an exit has steps, wheelchair users cannot use it.',
    intermediate: 'Wheelchair users are modelled at 0.7–1.0 m/s with a 0.72 m wide body and avoid exits marked not step-free; on stairs they are carried at about 0.12 m/s. They are often among the last out, which risk analysis flags.',
    advanced: 'Per-profile speeds, radii and reaction multipliers; route choice for category 2 excludes inaccessible exits (fallback to any if none). Narrow gaps below 2 × 0.36 m physically block wheelchair agents, which can leave them unable to evacuate — reported as a high-severity finding.' },
  fis: { k: /faster.?is.?slower|panic/, t: 'Faster-is-slower effect', lab: 'fis',
    beginner: 'When people panic and push, they jam the door, so everyone gets out more slowly even though they are rushing.',
    intermediate: 'Pushing makes people form arches at the exit that block it for moments. The Learn explainer runs the same 60 people through one 1 m exit calmly and rushing, and shows the measured times for both.',
    advanced: 'Helbing, Farkas & Vicsek (2000) show clogging from friction at high desired speed. EvacPrint parameterises it: discharge × (1 − 0.45·panic·clamp((ρ_front − 2.5)/2.5, 0, 1)), with panic also raising speed 30 % and reducing rerouting.' },
  recs: { k: /recommend|suggest|improve|fix/, t: 'Recommendation engine',
    beginner: 'EvacPrint tries changes for you — a wider door, an extra exit, moving furniture — runs the whole evacuation again for each, and lists which ones save the most time.',
    intermediate: 'Every applicable change is simulated on 3 random seeds with the same occupants. A change is marked “helps on every seed” only if it saves time in all three runs; otherwise it is within noise.',
    advanced: 'Candidates are generated from geometry (widen/unblock openings, design options, extra exit on the farthest exterior wall, obstacle removal near openings, aisles through long rows, accessibility, reopened zones), simulated in a Web Worker pool, ranked by mean ΔRSET with min/max across seeds and peak-density / exit-use deltas.' },
  graphs: { k: /graph|chart|curve|report|interpret/, t: 'Reading the charts',
    beginner: 'The evacuation curve shows how many people are out over time. A flat part means people are waiting — usually at a door.',
    intermediate: 'Steep sections = exits working at capacity; flat sections at the start = pre-movement; a long tail = a few slow people or a jammed door. Exit bars show how evenly exits are used.',
    advanced: 'The curve slope equals total discharge rate (p/s); compare it with Σ capacities to see whether evacuation is capacity- or arrival-limited. T95 vs T100 gap indicates stragglers (often reduced-mobility occupants).' },
};

const fmt = (v) => (v == null ? '—' : `${(+v).toFixed(1)} s`);

export function offlineReply(text, level = 'intermediate') {
  const q = text.toLowerCase();
  const ctx = snapshot();
  const sim = ctx.simulation;
  const res = ctx.last_completed_run;
  const out = { text: '', actions: [], highlight: null, learn: null };

  // ---- real emergency guard
  if (/(there is|there's|actual|real).*(fire|emergency)|help.*(fire|trapped)|we are trapped/.test(q)) {
    out.text = 'If this is a real emergency, follow the venue’s emergency procedure and call 112 now. EvacPrint is a planning simulator — its routes are not live evacuation directions.';
    return out;
  }
  // ---- actions
  const num = (q.match(/\b(\d{1,4})\b/) || [])[1];
  const openingIn = () => ctx.openings.find((o) => q.includes(o.name.toLowerCase())) || ctx.openings.find((o) => new RegExp(`\\b(door|exit)\\s*${o.name.split(' ').pop().toLowerCase()}\\b`).test(q));
  if (/(run|start|play).*(blocked|block).*(scenario|exit)/.test(q)) { out.text = 'I can switch to the Blocked exit scenario (Door B closed) and reset the simulator.'; out.actions.push({ name: 'set_scenario', input: { scenario: 'blocked' } }); return out; }
  if (/compare/.test(q) && /(normal|blocked|large|mixed)/.test(q)) {
    const ids = ['normal', 'blocked', 'large', 'mixed'].filter((s) => q.includes(s));
    if (ids.length >= 2) { out.text = `I can run ${ids[0]} and ${ids[1]} side by side with the same seed.`; out.actions.push({ name: 'compare_scenarios', input: { a: ids[0], b: ids[1] } }); return out; }
  }
  if (/(widen|wider)/.test(q) && openingIn()) { const o = openingIn(); out.text = `I can test ${o.name} 1 m wider on a copy of the layout and compare it with the current one.`; out.actions.push({ name: 'what_if', input: { description: `${o.name} widened by 1.0 m`, widen_exit: o.name } }); return out; }
  if (/(block|close)/.test(q) && openingIn() && !/what|why|how/.test(q)) { const o = openingIn(); out.text = `I can block ${o.name} in the live simulator.`; out.actions.push({ name: 'set_exit_blocked', input: { exit: o.name, blocked: true } }); return out; }
  if (/(open|unblock|reopen)/.test(q) && openingIn()) { const o = openingIn(); out.text = `I can reopen ${o.name}.`; out.actions.push({ name: 'set_exit_blocked', input: { exit: o.name, blocked: false } }); return out; }
  if (/(increase|set|change|make).*(population|people|occupan|crowd)/.test(q) && num) { out.text = `I can set the simulation to ${num} occupants.`; out.actions.push({ name: 'set_occupancy', input: { count: +num } }); return out; }
  if (/(generate|create|make|save).*report/.test(q)) { out.text = res ? 'I can save a report of the last completed run.' : 'There is no completed run yet. Run the simulation to the end first, then ask again.'; if (res) out.actions.push({ name: 'generate_report', input: {} }); return out; }
  if (/(run|start).*(recommend|improve|suggest)/.test(q)) { out.text = 'I can run the recommendation engine on the current layout.'; out.actions.push({ name: 'run_recommendations', input: {} }); return out; }
  if (/^(run|start|play)\b|run (the )?simulation/.test(q)) { out.text = 'I can reset and start the live simulation.'; out.actions.push({ name: 'run_simulation', input: {} }); return out; }

  // ---- questions about the current simulation
  if (/progress|status|how many.*(out|evacuated)|how far/.test(q)) {
    out.text = sim.status === 'not started' ? `The simulation has not started yet. ${ctx.parameters.occupants} occupants are configured in ${ctx.venue.name}.` : `At t = ${sim.time_s} s, ${sim.evacuated} of ${sim.evacuated + sim.still_inside} people are out (${Math.round((sim.evacuated / Math.max(1, sim.evacuated + sim.still_inside)) * 100)} %). ${sim.reacting} are still reacting, ${sim.moving} are moving and ${sim.congested_now} of those are slowed by congestion.${res && sim.status === 'complete' ? ` The run finished in ${fmt(res.rset_s)}.` : ''}`;
    return out;
  }
  if (/(highest|most).*(density|crowd)|which exit.*(dense|crowd|busy)/.test(q)) {
    const top = ctx.openings.filter((o) => !o.blocked).sort((a, b) => b.density_in_front_p_m2 - a.density_in_front_p_m2)[0];
    if (!top || sim.status === 'not started') { out.text = 'There is no crowd yet — start the simulation first.'; return out; }
    out.text = `Right now the densest opening is ${top.name}: about ${top.density_in_front_p_m2} p/m² in front of it, ${top.queue_now} people queuing, ${top.people_through} through so far (capacity ${top.capacity_p_s} p/s).`;
    out.highlight = { target: top.name, label: `${top.name} · ${top.density_in_front_p_m2} p/m²` };
    return out;
  }
  if (/(stuck|jam|why).*(exit|door)|bottleneck|biggest problem/.test(q)) {
    const o = openingIn();
    if (o) {
      out.text = `${o.name} is ${o.width_m.toFixed(1)} m wide, so it can pass about ${o.capacity_p_s} people per second. ${o.blocked ? 'It is blocked in this scenario, so everyone who would use it reroutes.' : `It has ${o.queue_now} people queuing now with ${o.density_in_front_p_m2} p/m² in front, and ${o.people_through} have passed. People get stuck when they arrive faster than that capacity.`}`;
      out.highlight = { target: o.name, label: o.name };
      return out;
    }
    const b = (res?.bottlenecks?.length ? res.bottlenecks : sim.live_bottlenecks)[0];
    out.text = b ? `The biggest bottleneck ${res ? 'in the last run' : 'right now'} is at ${b.where}, peaking at ${b.peak} p/m²${b.exposure_cell_s ? ` with ${b.exposure_cell_s} cell-seconds above LOS F` : ''}. It forms because people reach that opening faster than it can discharge them.` : 'No area is above 2.15 p/m² (LOS F) at the moment.';
    if (b) out.highlight = { target: 'B1', label: `B1 · ${b.where}` };
    return out;
  }
  if (/longer than|slower than|previous run/.test(q)) {
    const p = ctx.previous_run;
    if (!p || !res) { out.text = 'I need two completed runs to compare. Finish this run and the previous one is kept automatically.'; return out; }
    const d = res.rset_s - p.rset_s;
    out.text = `This run took ${fmt(res.rset_s)} versus ${fmt(p.rset_s)} before (${d >= 0 ? '+' : ''}${d.toFixed(1)} s). Occupants: ${p.occupants} → ${ctx.parameters.occupants}; peak density ${p.peak} → ${res.peak_density.value} p/m². Layout changes now: ${ctx.layout_changes.join('; ') || 'none'}; blocked: ${ctx.openings.filter((o) => o.blocked).map((o) => o.name).join(', ') || 'none'}.`;
    return out;
  }
  if (/blocked exit.*affect|effect of.*block/.test(q)) {
    const bl = ctx.openings.filter((o) => o.blocked);
    out.text = bl.length ? `${bl.map((o) => o.name).join(' and ')} ${bl.length > 1 ? 'are' : 'is'} blocked, removing ${bl.reduce((s, o) => s + o.width_m, 0).toFixed(1)} m of exit width. Everyone reroutes to the remaining openings: ${ctx.openings.filter((o) => !o.blocked && o.kind === 'hall door').map((o) => `${o.name} ${o.people_through}`).join(', ')} people so far.` : 'No exit is blocked in the current layout. Ask me to run the blocked-exit scenario to see the effect.';
    return out;
  }
  if (/explain.*heat ?map|what.*colou?rs/.test(q)) {
    out.text = `${KB.density[level]} ${sim.status !== 'not started' ? `The highest density so far is ${ctx.simulation.peak_density_so_far.value} p/m² (LOS ${ctx.simulation.peak_density_so_far.los}).` : ''}`;
    return out;
  }
  if (/risk/.test(q) && res) { out.text = res.risk_findings.length ? `The last run has ${res.risk_findings.length} findings. The most serious: ${res.risk_findings.slice(0, 3).map((f) => `${f.title} (${f.severity})`).join('; ')}. These are model estimates, not a safety certification.` : 'The last run raised no risk findings.'; return out; }

  // ---- learning
  for (const [id, e] of Object.entries(KB)) if (e.k.test(q)) { out.text = e[level] || e.intermediate; out.learn = e.lab || null; return out; }

  out.text = 'I’m the offline guide, so I only understand set phrases. Try: “What is the current evacuation progress?”, “Which exit has the highest crowd density?”, “Why are people getting stuck near Door B?”, “Explain Dijkstra”, “Run a blocked-exit scenario”, “Test a wider Door A” or “Generate a report”. Connect the AI service for open conversation.';
  return out;
}

export { KB };
void ctl;
