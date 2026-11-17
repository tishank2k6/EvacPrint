import { icon } from '../ui/icons.js';
import { dijkstra, abm, bottleneckId, speedDensity } from '../ui/illustrations.js';
import { MODEL, weidmannFactor } from '../sim/engine.js';

const PARAMS = [
  ['Grid resolution', '0.5 m cells', 'Fine enough for 1 m aisles and 0.5 m seat rows'],
  ['Time step', `${MODEL.dt} s`, 'Fixed step; rendering interpolates between steps'],
  ['Free walking speed (adult)', '1.34 ± 0.15 m/s, clipped 1.0–1.6', 'Weidmann (1993)'],
  ['Reduced mobility / wheelchair', '0.7–1.0 m/s', 'Planning ranges for elderly and wheelchair users — verify'],
  ['Body radius', '0.22 m adult · 0.36 m wheelchair', 'Shoulder width ≈ 0.45 m'],
  ['Speed–density relation', 'v = v₀ [1 − e^(−1.913 (1/ρ − 1/5.4))]', 'Weidmann (1993) fundamental diagram'],
  ['Door / exit discharge', '1.33 persons / s per metre clear width', 'SFPE Handbook specific flow (planning value)'],
  ['Local density', 'Gaussian kernel, R = 0.7 m', 'Helbing, Johansson & Al-Abideen (2007)'],
  ['Danger threshold', '2.15 p/m² (LOS F) · 4.0 p/m² critical', 'Fruin (1971) walkway levels of service'],
  ['Pre-movement time', 'User range, default 10–30 s', 'Typical drill observations 10–60 s'],
  ['Route choice', 'Per-exit Dijkstra field + congestion cost, every 2 s', 'Dynamic floor field (cf. Kretz; Treuille et al. 2006)'],
  ['Panic', '+30 % speed, faster reaction, less rerouting, door clogging', 'Phenomenological, after Helbing et al. (2000)'],
];

const COMPARE = [
  ['Runs in', 'Any browser, offline', 'Installed desktop software'],
  ['Users', 'Venue administrators, event organisers', 'Trained fire-safety consultants'],
  ['Output', 'Ranked design fixes + report', 'Simulation results to interpret'],
  ['Setup time', 'Minutes', 'Days (licensing, model building)'],
  ['Fidelity', 'Comparative planning model', 'Validated, certification-grade'],
];

export function mount(root) {
  root.innerHTML = `
  <div class="wrap">
    <header class="page-head">
      <span class="eyebrow">Technology</span>
      <h1>A small, honest model you can inspect.</h1>
      <p>EvacPrint uses established pedestrian-dynamics results, implemented compactly enough to run hundreds of full evacuations in a browser. Every parameter and its source is listed here.</p>
    </header>

    <section class="tech-ills">
      <figure class="card tech-fig wide"><div class="ill-host">${dijkstra({ big: true })}</div>
        <figcaption><h3>${icon('route')}Dijkstra distance field</h3><p>The numbers are produced by EvacPrint’s own Dijkstra routine on this small grid. Starting at the exit (teal), cost spreads outward around the walls; the amber path from the white start simply follows decreasing cost. In the venue, one such field per exit is recomputed every 2 s with a congestion penalty, so routes bend away from queues.</p></figcaption></figure>
      <figure class="card tech-fig"><div class="ill-host">${abm({ big: true })}</div>
        <figcaption><h3>${icon('users')}Agent-based modelling</h3><p>Every occupant is an independent agent with its own speed, size, reaction time and target exit. Agents move through four states; the waiting and queuing time of each is recorded for the report.</p></figcaption></figure>
      <figure class="card tech-fig"><div class="ill-host">${bottleneckId({ big: true })}</div>
        <figcaption><h3>${icon('target')}Bottleneck detection</h3><p>The smoothed density field is thresholded at Fruin LOS F, touching cells are grouped, and only zones that stay critical for at least 3 s are reported, ranked by exposure × peak density and named after the nearest door or aisle.</p></figcaption></figure>
    </section>

    <section class="section">
      <div class="section-head"><span class="eyebrow">Model card</span><h2>Parameters and sources</h2><p>Values marked as planning values should be verified against the cited literature and local code (NBC 2016 Part 4) before quoting absolute times.</p></div>
      <div class="tech-two">
        <div class="card table-card"><table class="ptable"><thead><tr><th>Parameter</th><th>Value</th><th>Basis</th></tr></thead><tbody>
          ${PARAMS.map(([a, b, c]) => `<tr><td>${a}</td><td class="mono">${b}</td><td class="faint">${c}</td></tr>`).join('')}
        </tbody></table></div>
        <figure class="card tech-fig"><div class="ill-host">${speedDensity({ marker: 2.15 })}</div><figcaption><h3>${icon('gauge')}Speed falls with density</h3><p>The curve the engine evaluates for every agent, every step. The marker sits at 2.15 p/m², where Fruin’s LOS F begins and walking speed has already dropped to ${(1.34 * weidmannFactor(2.15)).toFixed(2)} m/s.</p></figcaption></figure>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><span class="eyebrow">Architecture</span><h2>One engine, many views</h2><p>The simulation core is plain JavaScript with no DOM access. The same module runs the live view on the main thread, the what-if analyses in Web Workers, and the verification script in Node.</p></div>
      <div class="card arch">${archSvg()}</div>
      <div class="stack-grid">
        ${[
          ['Simulation core', 'Vanilla ES modules, typed arrays, seeded PRNG — deterministic and testable (npm run test:sim).'],
          ['2D plan', 'Canvas 2D with cached drafting layers; positions interpolated between 0.1 s steps.'],
          ['3D view', 'Three.js r169, lazy-loaded; instanced agents and seats, live DataTexture heatmap, 2D fallback.'],
          ['What-if engine', 'Pool of up to 4 Web Workers running full headless simulations in parallel.'],
          ['Accounts', 'Demo mode: WebCrypto PBKDF2-SHA-256 (210k iterations) in localStorage — clearly not production security.'],
          ['Build', 'Vite; fonts self-hosted (IBM Plex) so the demo runs fully offline.'],
        ].map(([t, d]) => `<div class="card pad"><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><span class="eyebrow">Positioning</span><h2>Where EvacPrint fits — and where it does not</h2></div>
      <div class="tech-two">
        <div class="card table-card"><table class="ptable"><thead><tr><th></th><th>EvacPrint</th><th>Pathfinder, MassMotion, Vadere, JuPedSim</th></tr></thead><tbody>
          ${COMPARE.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td class="faint">${c}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="stack">
          <div class="callout amber">${icon('warning')}<span><strong>Limitations.</strong> EvacPrint is a comparative decision-support tool. It does not model fire or smoke, stairs as separate geometry, group behaviour or counter-flow, and its door-flow and panic parameters are planning values. Use it to compare design options, not to certify a building.</span></div>
          <div class="callout teal">${icon('shield')}<span><strong>Validation plan.</strong> Run a timed drill in Seminar Hall 406, record pre-movement times and door counts, and calibrate reaction-time and flow parameters until simulated and observed exit curves agree.</span></div>
          <div class="callout">${icon('info')}<span><strong>Digital twin, honestly.</strong> Today the model is built from the measured layout with a live occupancy input. Real sensors — entry counters, CCTV head-counts — are future scope.</span></div>
        </div>
      </div>
    </section>
  </div>`;
  return () => {};
}

function archSvg() {
  const box = (x, y, w, h, t, s, cls = '') => `<g class="ab ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/><text x="${x + 14}" y="${y + 24}" class="ab-t">${t}</text><text x="${x + 14}" y="${y + 42}" class="ab-s">${s}</text></g>`;
  const ar = (d) => `<path d="${d}" class="ae" marker-end="url(#am)"/>`;
  return `<svg viewBox="0 0 960 300" role="img" aria-label="EvacPrint architecture diagram" class="arch-svg">
    <defs><marker id="am" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="currentColor"/></marker></defs>
    <text x="20" y="22" class="ab-lane">MAIN THREAD</text>
    <text x="20" y="282" class="ab-lane">WEB WORKERS</text>
    ${box(20, 40, 170, 60, 'Layout model', 'grid · openings · options')}
    ${box(250, 40, 190, 60, 'Simulation engine', 'fields · agents · density', 'core')}
    ${box(500, 40, 190, 60, 'Shared controller', 'one live instance · clock')}
    ${box(750, 30, 190, 40, '2D floor plan', 'Canvas 2D')}
    ${box(750, 80, 190, 40, '3D view', 'Three.js · lazy')}
    ${box(750, 130, 190, 40, 'Charts · metrics', 'SVG')}
    ${box(250, 200, 190, 60, 'Engine (headless) ×4', 'what-if & benchmarks', 'core')}
    ${box(500, 200, 190, 60, 'Recommendation engine', 'rank by seconds saved')}
    ${box(750, 200, 190, 60, 'Reports', 'per user · print / PDF')}
    ${ar('M190 70 H246')}${ar('M440 70 H496')}${ar('M690 60 C720 60 720 50 746 50')}${ar('M690 70 H746 ')}${ar('M690 80 C720 80 720 150 746 150')}
    ${ar('M105 100 C105 230 160 230 246 230')}${ar('M440 230 H496')}${ar('M690 230 H746')}${ar('M595 200 V104')}
  </svg>`;
}
