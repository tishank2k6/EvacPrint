import { icon } from '../ui/icons.js';
import { esc, reducedMotion, onVisible, fmtSec } from '../ui/dom.js';
import { createHall406, cloneLayout } from '../sim/layout.js';
import { runBatch } from '../sim/batch.js';

export const NODES = [
  { id: 'layout', t: 'Building Layout', ic: 'building', what: 'Describes the venue: walls, seating rows, stage, furniture, hall doors and final exits.', why: 'An evacuation is only as realistic as its geometry — door widths and aisle spacing decide where queues form.', input: 'Measured plan of Seminar Hall 406, or edits painted in the layout editor.', output: 'A layout object (cell types, opening names, blocked list, design options).', algo: 'Parametric builder + brush editor', file: 'src/sim/layout.js' },
  { id: 'grid', t: 'Grid Conversion', ic: 'grid', what: 'Rasterises the venue into 0.5 m × 0.5 m cells and derives which cells are walkable.', why: 'A uniform grid makes routing, collision lookup and density binning fast and simple enough to run hundreds of times.', input: 'Layout object.', output: 'Passable mask, seat list, standing-area list, spatial buckets.', algo: 'compile() — typed arrays, O(cells)', file: 'src/sim/layout.js · compile()' },
  { id: 'exits', t: 'Exit Identification', ic: 'exit', what: 'Groups touching door / exit cells into named openings and computes each one’s clear width and discharge capacity.', why: 'Doors are the main bottleneck; the engine must know how many people per second each can pass.', input: 'Door and exit cells; blocked flags.', output: 'Openings with width (m), capacity = 1.33 p/s × width, blocked state.', algo: '4-connected flood fill', file: 'src/sim/layout.js · detectGroups()' },
  { id: 'dijkstra', t: 'Dijkstra Distance Field', ic: 'route', what: 'For every open exit, computes the walking cost from each cell to that exit; recomputed every 2 s with a congestion penalty.', why: 'One field serves every agent: each person just walks downhill, so routing cost does not grow with crowd size.', input: 'Passable grid, exit cells, current density.', output: 'Per-exit distance fields and their gradients.', algo: 'Multi-source Dijkstra, 8-connected, no corner cutting; cost × (1 + 0.45 ρ)', file: 'src/sim/pathfinding.js' },
  { id: 'agents', t: 'Agent Generation', ic: 'users', what: 'Places occupants in seats (then standing areas), and gives each a profile, free walking speed, body size and reaction time.', why: 'Mixed crowds evacuate differently; reproducible seeds make design comparisons fair.', input: 'Occupancy, mobility mix, wheelchair users, reaction-time range, seed.', output: 'N agents with individual attributes.', algo: 'Seeded PRNG (mulberry32); v₀ ~ N(1.34, 0.15) m/s', file: 'src/sim/engine.js · spawn()' },
  { id: 'move', t: 'Crowd Movement Simulation', ic: 'simulator', what: 'Advances every agent in 0.1 s steps: reaction delay, steering along the field, density-dependent speed, collisions, queuing at doors.', why: 'Movement is where congestion emerges; it must stay stable with 400 agents in real time.', input: 'Agents, distance fields, density.', output: 'Positions, states and exit times over time.', algo: 'Weidmann speed–density + position-based collision + SFPE door-flow gates', file: 'src/sim/engine.js · step()' },
  { id: 'density', t: 'Density Calculation', ic: 'heat', what: 'Estimates persons per square metre at every cell from nearby agent positions.', why: 'Density drives walking speed, the heatmap colours and bottleneck detection.', input: 'Positions of moving agents.', output: 'Density field (instant and 1 s smoothed), peak map, exposure map.', algo: 'Gaussian kernel, R = 0.7 m (Helbing et al. 2007)', file: 'src/sim/engine.js · computeDensity()' },
  { id: 'bottleneck', t: 'Bottleneck Detection', ic: 'target', what: 'Finds zones above Fruin LOS F (2.15 p/m²), measures how long they stay critical, and names their location.', why: 'Administrators need to know where the problem is, not just that evacuation is slow.', input: 'Smoothed density, exposure time per cell.', output: 'Ranked bottleneck zones with label, area, peak density and duration.', algo: '8-connected components + persistence ranking', file: 'src/sim/engine.js · scanBottlenecks()' },
  { id: 'recommend', t: 'Recommendation Engine', ic: 'sparkle', what: 'Generates every applicable design change, re-runs the full evacuation for each on 3 seeds, and ranks by seconds saved.', why: 'EvacPrint does not stop at simulation — it tests fixes and keeps only those that help consistently.', input: 'Current layout, scenario parameters.', output: 'Ranked changes with mean and range of time saved, density change, significance.', algo: 'Headless what-if runs in a Web Worker pool', file: 'src/sim/recommend.js' },
  { id: 'report', t: 'Final Evacuation Report', ic: 'report', what: 'Summarises the run for a venue administrator: evacuation time, worst bottleneck, exit loads, top fixes and before/after.', why: 'Results must be understandable and shareable by non-experts.', input: 'Completed run, recommendations, comparison.', output: 'Saved report (per user) with print / PDF export.', algo: 'Report view + print stylesheet', file: 'src/pages/reports.js' },
];

const SMALL = [
  { id: 'path', t: 'Pathfinding workflow', steps: [['Grid', 'Passable cells at 0.5 m'], ['Accessible exits', 'Open exits only; blocked ones become walls'], ['Distance calculation', 'Dijkstra from each exit, with congestion cost'], ['Route selection', 'Each agent picks the lowest-cost exit, with hysteresis'], ['Agent movement', 'Steer down the interpolated gradient']] },
  { id: 'rec', t: 'Recommendation workflow', steps: [['Baseline simulation', '3 seeds of the current layout'], ['Detect problem', 'Worst bottleneck and its location'], ['Generate modifications', 'Widen, unblock, add exit, clear, remove row'], ['Rerun simulations', 'Same occupants, same seeds'], ['Compare results', 'Mean, min and max seconds saved'], ['Rank improvements', 'Only changes that help on every seed are marked']] },
];

export function mount(root) {
  root.innerHTML = `
  <div class="wrap">
    <header class="page-head">
      <span class="eyebrow">How it works</span>
      <h1>One grid, one engine, ten steps from floor plan to report.</h1>
      <p>Select any step to see what it does, why it is needed, what goes in and out, and the algorithm behind it. Each step maps to a real module in the code.</p>
    </header>
    <section class="flow-sec">
      <div class="flow-wrap card">
        <div class="flow-svg" data-flow></div>
        <aside class="flow-detail" data-detail aria-live="polite"></aside>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><span class="eyebrow">Inside the engine</span><h2>Three smaller workflows</h2></div>
      <div class="mini-flows">
        ${SMALL.map((f) => `<div class="mf card"><h3>${f.t}</h3><ol class="chain">${f.steps.map(([s, d], i) => `<li tabindex="0"><span class="mono ch-n">${i + 1}</span><b>${s}</b><em>${d}</em></li>`).join('')}</ol></div>`).join('')}
        <div class="mf card"><h3>Evacuation workflow <span class="chip" data-evac-src>measured</span></h3>
          <ol class="chain evac" data-evac>
            ${['Alarm', 'Reaction time', 'Walking', 'Queuing', 'Exit', 'Evacuated'].map((s, i) => `<li tabindex="0"><span class="mono ch-n">${i + 1}</span><b>${s}</b><em data-ev="${i}">…</em></li>`).join('')}
          </ol>
          <p class="faint small" data-evac-note>Timings from a full run of the normal scenario (200 occupants, seed 406), computed when this card scrolled into view.</p>
        </div>
      </div>
    </section>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let sel = 0;

  const renderDetail = () => {
    const n = NODES[sel];
    $('[data-detail]').innerHTML = `
      <div class="fd-head"><span class="fd-ic">${icon(n.ic)}</span><div><span class="mono faint">STEP ${String(sel + 1).padStart(2, '0')} / 10</span><h2>${n.t}</h2></div></div>
      <p class="fd-what">${esc(n.what)}</p>
      <dl class="fd">
        <div><dt>Why it is required</dt><dd>${esc(n.why)}</dd></div>
        <div><dt>Receives</dt><dd>${esc(n.input)}</dd></div>
        <div><dt>Produces</dt><dd>${esc(n.output)}</dd></div>
        <div><dt>Algorithm / technology</dt><dd class="mono">${esc(n.algo)}</dd></div>
        <div><dt>Code</dt><dd class="mono faint">${esc(n.file)}</dd></div>
      </dl>
      <div class="row gap8"><button class="btn sm" data-prev ${sel === 0 ? 'disabled' : ''}>${icon('arrowLeft')}Previous</button><button class="btn sm" data-next ${sel === 9 ? 'disabled' : ''}>Next${icon('arrowRight')}</button></div>`;
    $('[data-prev]').onclick = () => { sel = Math.max(0, sel - 1); draw(); renderDetail(); };
    $('[data-next]').onclick = () => { sel = Math.min(9, sel + 1); draw(); renderDetail(); };
  };

  // ------------------------------------------------------------ flowchart SVG
  function draw() {
    const host = $('[data-flow]');
    const W = host.clientWidth || 700;
    const cols = W > 560 ? 2 : 1;
    const rows = Math.ceil(NODES.length / cols);
    const nw = cols === 2 ? Math.min(250, (W - 120) / 2) : Math.min(320, W - 40);
    const nh = 54, gy = 26, gx = cols === 2 ? W - 2 * nw - 40 : 0;
    const H = rows * nh + (rows - 1) * gy + 20;
    const pos = NODES.map((_, i) => {
      // U-shaped serpentine: down the left column, then back up the right column
      const col = cols === 2 ? Math.floor(i / rows) : 0;
      const row = cols === 2 ? (col === 0 ? i % rows : rows - 1 - (i % rows)) : i;
      const x = cols === 2 ? 20 + col * (nw + gx) : (W - nw) / 2;
      return { x, y: 10 + row * (nh + gy) };
    });
    let edges = '';
    for (let i = 0; i < NODES.length - 1; i++) {
      const a = pos[i], b = pos[i + 1];
      let d;
      if (a.x === b.x) d = b.y > a.y ? `M${a.x + nw / 2} ${a.y + nh} L${b.x + nw / 2} ${b.y}` : `M${a.x + nw / 2} ${a.y} L${b.x + nw / 2} ${b.y + nh}`;
      else { const mx = (a.x + nw + b.x) / 2; d = `M${a.x + nw} ${a.y + nh / 2} C${mx} ${a.y + nh / 2} ${mx} ${b.y + nh / 2} ${b.x} ${b.y + nh / 2}`; }
      edges += `<path id="fe${i}" d="${d}" class="fe ${i < sel ? 'done' : ''}" marker-end="url(#fa)"/>`;
      if (!reducedMotion()) edges += `<circle r="3" class="pkt"><animateMotion dur="${2.2}s" begin="-${(i * 0.22).toFixed(2)}s" repeatCount="indefinite"><mpath href="#fe${i}"/></animateMotion></circle>`;
    }
    const nodes = NODES.map((n, i) => {
      const p = pos[i];
      return `<g class="fn ${i === sel ? 'sel' : ''}" data-n="${i}" tabindex="0" role="button" aria-label="${n.t}" transform="translate(${p.x} ${p.y})">
        <rect width="${nw}" height="${nh}" rx="10"/>
        <text x="16" y="22" class="fn-i">${String(i + 1).padStart(2, '0')}</text>
        <text x="16" y="40" class="fn-t">${n.t}</text>
        <g transform="translate(${nw - 34} ${nh / 2 - 10}) scale(.85)" class="fn-ic">${icon(n.ic).replace('<svg', '<svg width="24" height="24"')}</g>
      </g>`;
    }).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="EvacPrint system flowchart">
      <defs><marker id="fa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="currentColor"/></marker></defs>
      ${edges}${nodes}</svg>`;
    host.querySelectorAll('[data-n]').forEach((g) => {
      const act = () => { sel = +g.dataset.n; draw(); renderDetail(); if (window.innerWidth < 900) $('[data-detail]').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); };
      g.addEventListener('click', act);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    });
  }
  const ro = new ResizeObserver(() => draw());
  ro.observe($('[data-flow]'));
  draw();
  renderDetail();

  // ------------------------------------------------------------ measured evacuation workflow
  const stopVis = onVisible($('[data-evac]'), async () => {
    const [r] = await runBatch([{ layout: cloneLayout(createHall406()), params: { occupants: 200, slowFraction: 0.05, reactionMin: 10, reactionMax: 30, panic: 0.2, seed: 406 } }]);
    if (!root.isConnected) return;
    const firstOut = r.groups.filter((g) => g.type === 'exit' && g.first != null).reduce((m, g) => Math.min(m, g.first), Infinity);
    const vals = ['t = 0 s, all occupants alerted', `individual delays of ${r.params.reactionMin}–${r.params.reactionMax} s`, `mean walking time ${fmtSec(r.meanTravel)}`, `mean time queuing ${fmtSec(r.meanQueue)}`, `first person out at ${fmtSec(firstOut)}`, `last person out at ${fmtSec(r.rset)} (RSET)`];
    vals.forEach((v, i) => { root.querySelector(`[data-ev="${i}"]`).textContent = v; });
  });

  return () => { ro.disconnect(); stopVis(); };
}
