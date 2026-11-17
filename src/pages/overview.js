import { icon, logoMark } from '../ui/icons.js';
import { esc, onVisible, watchVisible, reducedMotion, fmtSec } from '../ui/dom.js';
import { storyArt } from '../ui/illustrations.js';
import { createHall406, cloneLayout, generateCandidates } from '../sim/layout.js';
import { Simulation } from '../sim/engine.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { runBatch } from '../sim/batch.js';
import { LoopDriver, IsoLive } from '../render/iso.js';
import { FloorPlan2D, renderStaticPlan } from '../render/floorplan.js';
import { densityLegend, renderCompare } from '../ui/compare.js';
import { BAND, bandOf } from '../render/colors.js';
import { serializeLayout } from '../sim/layout.js';
import { currentUser } from '../auth/auth.js';

let benchCache = null; // { scenarios: [...results], showcase: {...} }

const STORY = [
  ['risk', 'A building has a hidden evacuation risk', 'Narrow doors, blocked exits and dense seating create queues no one has measured.'],
  ['digitize', 'EvacPrint converts it into a virtual venue', 'The measured plan becomes a 0.5 m grid of walls, seats, doors and exits.'],
  ['simulate', 'Virtual people live through the emergency', 'Each agent reacts, chooses an exit, walks, slows in crowds and queues at doors.'],
  ['detect', 'Congestion and bottlenecks are found', 'Density above Fruin LOS F that persists for seconds is flagged and located.'],
  ['test', 'Design improvements are tested', 'Every applicable change is simulated again with the same occupants.'],
  ['recommend', 'The best changes are recommended', 'Changes are ranked by seconds saved, and only kept if they help on every seed.'],
  ['report', 'Administrators receive a clear report', 'Evacuation time, worst bottleneck, top fixes and a before/after view.'],
];

export function mount(root) {
  const user = currentUser();
  const simLink = user ? '#/simulator' : '#/login?next=%2Fsimulator';
  root.innerHTML = `
  <section class="hero">
    <div class="hero-scene" aria-hidden="false"><div class="hero-canvas"></div><div class="hero-fade"></div></div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <span class="eyebrow">Crowd evacuation simulation · digital blueprint</span>
        <h1>Every Second Matters.<br/><span>Every Exit Counts.</span></h1>
        <p class="hero-sub mono">Simulate. Predict. Optimize. Protect.</p>
        <p class="hero-lede">EvacPrint simulates how a crowd leaves a real venue, pinpoints where it jams, and tests layout changes until it finds the ones that get people out faster — in the browser, before an emergency ever happens.</p>
        <div class="row gap10 wrap-row">
          <a class="btn primary lg" href="${simLink}">${icon('play')}Open Simulator</a>
          <a class="btn lg outline" href="#/how-it-works">${icon('flow')}Explore How It Works</a>
        </div>
      </div>
      <div class="hero-readout" aria-live="off">
        <div class="hr-h"><span class="dot-live"></span><span class="mono">LIVE ENGINE · Seminar Hall 406</span></div>
        <div class="hr-grid">
          <div><span>Simulated time</span><b class="mono" data-h-t>0.0 s</b></div>
          <div><span>Evacuated</span><b class="mono" data-h-ev>0 / 0</b></div>
          <div><span>Peak density</span><b class="mono" data-h-pk>0.00</b></div>
          <div><span>Phase</span><b class="mono" data-h-ph>—</b></div>
        </div>
        <p class="faint small">Not a video: a private instance of the simulation engine, rendered in 3D. Density overlay builds up as congestion forms.</p>
      </div>
    </div>
  </section>

  <section class="section story-sec">
    <div class="wrap">
      <div class="section-head"><span class="eyebrow">The story</span><h2>From an unmeasured risk to a report an administrator can act on.</h2></div>
      <ol class="story">
        ${STORY.map(([k, t, d], i) => `<li class="story-i"><div class="story-art">${storyArt(k)}</div><div class="story-t"><span class="mono story-n">${String(i + 1).padStart(2, '0')}</span><h3>${t}</h3><p>${d}</p></div></li>`).join('')}
      </ol>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-head"><span class="eyebrow">Benchmark · computed on this page</span><h2>Four scenarios, simulated in your browser right now.</h2><p>These numbers are not typed in. When this section scrolled into view, EvacPrint ran each scenario to completion in background workers (seed 406) and reports what it measured.</p></div>
      <div class="bench" data-bench><div class="bench-loading"><span class="spinner"></span>Running 4 full evacuations…</div></div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-head"><span class="eyebrow">Visual library</span><h2>Four ways to see the same evacuation.</h2><p>All four views are generated from the engine — the same grid, the same agents, the same density model.</p></div>
      <div class="vis-grid">
        <figure class="vis card">
          <div class="vis-media iso-media" data-vis-iso></div>
          <figcaption><span class="mono vis-n">01</span><div><h3>3D auditorium cutaway</h3><p>Walls, 340 seats, stage, aisles, doors and exits extruded from the 0.5 m grid. Open the interactive model to rotate, pan and zoom.</p><div class="row gap8"><a class="btn sm" href="${user ? '#/3d' : '#/login?next=%2F3d'}">${icon('cube')}Interactive 3D</a><button class="btn sm ghost" data-dl="iso">${icon('download')}PNG</button></div></div></figcaption>
        </figure>
        <figure class="vis card">
          <div class="vis-media" data-vis-live></div>
          <figcaption><span class="mono vis-n">02</span><div><h3>Live crowd evacuation</h3><p>Agents react to the alarm, follow their routes and queue at doors. Exit chips show people through and current queue length.</p><div class="row gap8"><a class="btn sm" href="${simLink}">${icon('simulator')}Run your own</a><button class="btn sm ghost" data-dl="live">${icon('download')}PNG</button></div></div></figcaption>
        </figure>
        <figure class="vis card">
          <div class="vis-media" data-vis-heat><div class="bench-loading"><span class="spinner"></span>Waiting for the 400-person run…</div></div>
          <figcaption><span class="mono vis-n">03</span><div><h3>Crowd density heatmap</h3><p data-heat-cap>Peak density reached in every part of the hall during the larger-crowd scenario, with detected bottlenecks.</p><div class="row gap8"><button class="btn sm ghost" data-dl="heat">${icon('download')}PNG</button></div></div></figcaption>
          ${densityLegend('Peak density')}
        </figure>
        <figure class="vis card">
          <div class="vis-media" data-vis-ba><div class="bench-loading"><span class="spinner"></span>Testing a redesign…</div></div>
          <figcaption><span class="mono vis-n">04</span><div><h3>Before / after redesign</h3><p data-ba-cap>Same occupants, same seed: original layout versus the best of two tested changes.</p><div class="row gap8"><button class="btn sm" data-ba-open disabled>${icon('compare')}Full comparison</button></div></div></figcaption>
        </figure>
      </div>
    </div>
  </section>

  <section class="section cta-sec">
    <div class="wrap cta">
      <div><span class="eyebrow">Ready</span><h2>Test your evacuation before the emergency happens.</h2><p class="muted">Judges and visitors can enter the demo workspace with one click — no registration.</p></div>
      <div class="row gap10 wrap-row"><a class="btn primary lg" href="${simLink}">${icon('play')}Open Simulator</a><a class="btn lg outline" href="#/learn">${icon('learn')}Explore the science</a></div>
    </div>
  </section>
  <footer class="footer"><div class="wrap"><span class="brand">${logoMark(22)}<span>EvacPrint</span></span><span>RoboForge Open Innovation Hackathon · Simulation, Digital Twins &amp; Virtual Robotics track · A comparative decision-support tool, not a certification method.</span></div></footer>`;

  const $ = (s) => root.querySelector(s);
  const cleanups = [];

  // ---------------------------------------------------------- hero (3D, lazy)
  const heroDriver = new LoopDriver(() => new Simulation(createHall406(), { occupants: 160, reactionMin: 1, reactionMax: 12, panic: 0.3, seed: 100 + Math.floor(Math.random() * 900) }), { speed: 1.4, holdEnd: 4 });
  if (reducedMotion()) { for (let i = 0; i < 260; i++) heroDriver.sim.step(); heroDriver.paused = true; }
  cleanups.push(watchVisible($('.hero'), (v) => (heroDriver.visible = v)));
  let heroView = null;
  const host = $('.hero-canvas');
  (async () => {
    try {
      const { View3D, webglAvailable } = await import('../render/view3d.js');
      if (!root.isConnected) return;
      if (!webglAvailable()) throw new Error('no webgl');
      heroView = new View3D(host, heroDriver, { controls: false, toolbar: false, hero: true, glassWalls: true, wallHeight: 2.4, autoRotate: true, labels: false });
      heroView.setView('hero', true);
    } catch {
      heroView = new IsoLive(host, heroDriver, { pad: 20 });
    }
  })();
  let lastHud = 0;
  cleanups.push(heroDriver.subscribe((t) => {
    const n = performance.now();
    if (t === 'frame' && n - lastHud < 200) return;
    lastHud = n;
    const s = heroDriver.sim;
    $('[data-h-t]').textContent = `${s.t.toFixed(1)} s`;
    $('[data-h-ev]').textContent = `${s.evacuated} / ${s.N}`;
    $('[data-h-pk]').innerHTML = `${s.peak.value.toFixed(2)} <i class="pk-dot" style="background:${BAND[bandOf(s.peak.value)]}"></i>`;
    $('[data-h-ph]').textContent = heroDriver.phase;
  }));

  // ---------------------------------------------------------- visual 01 + 02 (live, lazy)
  let isoV = null, liveV = null, liveDriver = null;
  cleanups.push(onVisible($('[data-vis-iso]'), () => {
    const d = new LoopDriver(() => { const s = new Simulation(createHall406(), { occupants: 220, reactionMin: 0, reactionMax: 8, seed: 406 }); for (let i = 0; i < 230; i++) s.step(); return s; }, { speed: 0 });
    d.paused = true;
    isoV = new IsoLive($('[data-vis-iso]'), d, { pad: 10, glass: 0.9 });
    isoV.draw();
    cleanups.push(() => { isoV.destroy(); d.stop(); });
  }));
  cleanups.push(onVisible($('[data-vis-live]'), () => {
    liveDriver = new LoopDriver(() => { const L = cloneLayout(createHall406()); L.blocked = ['Door B']; return new Simulation(L, { occupants: 200, reactionMin: 2, reactionMax: 16, seed: 7 + Math.floor(Math.random() * 99) }); }, { speed: 2.2 });
    liveV = new FloorPlan2D($('[data-vis-live]'), liveDriver, { compact: false, interactive: true });
    cleanups.push(watchVisible($('[data-vis-live]'), (v) => (liveDriver.visible = v)));
    cleanups.push(() => { liveV.destroy(); liveDriver.stop(); });
  }));

  // ---------------------------------------------------------- benchmark + heat + before/after (workers)
  let baData = null;
  cleanups.push(onVisible($('[data-bench]'), async () => {
    if (!benchCache) {
      const base = createHall406();
      const items = SCENARIOS.map((sc) => { const l = cloneLayout(base); l.blocked = [...sc.blocked]; return { layout: l, params: { ...sc.params, seed: 406 } }; });
      const normal = SCENARIOS[0];
      const cands = generateCandidates(base).filter((c) => ['opt:west-exit', 'widen:Door A'].includes(c.id));
      cands.forEach((c) => items.push({ layout: c.layout, params: { ...normal.params, seed: 406 } }));
      const t0 = performance.now();
      const res = await runBatch(items);
      benchCache = { scen: res.slice(0, 4), cands: cands.map((c, k) => ({ title: c.title, layout: serializeLayout(c.layout), result: res[4 + k] })), ms: performance.now() - t0, base: serializeLayout(base) };
    }
    if (!root.isConnected) return;
    renderBench();
  }));

  function renderBench() {
    const { scen, cands, ms } = benchCache;
    const maxT = Math.max(...scen.map((r) => r.rset || r.simulatedTime));
    $('[data-bench]').innerHTML = `
      <div class="bench-grid">${scen.map((r, i) => {
        const sc = SCENARIOS[i];
        const worst = r.bottlenecks[0];
        return `<a class="bench-card card" href="${user ? `#/simulator?scenario=${sc.id}` : '#/login?next=%2Fsimulator'}">
          <div class="row between"><span class="mono faint">0${i + 1}</span><span class="chip ${i === 1 ? 'red' : i === 2 ? 'amber' : ''}">${esc(sc.short)}</span></div>
          <h3>${esc(sc.name)}</h3>
          <div class="bench-big"><b class="mono">${fmtSec(r.rset)}</b><span>to evacuate ${r.occupants}</span></div>
          <div class="bench-bar"><i style="width:${((r.rset || r.simulatedTime) / maxT) * 100}%"></i><b style="left:${(r.t95 / maxT) * 100}%" title="95 % evacuated"></b></div>
          <dl><div><dt>95 % out</dt><dd class="mono">${fmtSec(r.t95)}</dd></div><div><dt>Peak density</dt><dd class="mono"><i class="pk-dot" style="background:${BAND[bandOf(r.peakDensity.value)]}"></i>${r.peakDensity.value.toFixed(2)} p/m²</dd></div><div><dt>Worst bottleneck</dt><dd>${esc(worst?.label || 'none')}</dd></div></dl>
        </a>`;
      }).join('')}</div>
      <p class="faint small mono bench-foot">6 simulations · ${(ms / 1000).toFixed(1)} s in Web Workers · Δt = 0.1 s · seed 406 · reaction 10–30 s · bar marker = 95 % evacuated</p>`;

    // heat (larger crowd)
    const large = scen[2];
    const hv = $('[data-vis-heat]');
    hv.innerHTML = '<canvas class="fill"></canvas>';
    const L = cloneLayout(createHall406());
    renderStaticPlan(hv.querySelector('canvas'), L, { map: large.peakMap, markers: large.bottlenecks.slice(0, 3), openingLabels: true });
    $('[data-heat-cap]').textContent = `Peak density in every part of the hall with 400 occupants (seed 406). Worst zone: ${large.bottlenecks[0]?.label || '—'}, ${large.peakDensity.value.toFixed(2)} p/m² peak.`;

    // before/after: pick the stronger of two tested changes
    const normal = scen[0];
    const best = cands.slice().sort((a, b) => (a.result.rset ?? 999) - (b.result.rset ?? 999))[0];
    baData = { title: best.title, before: { result: normal, layout: benchCache.base }, after: { result: best.result, layout: best.layout } };
    const bv = $('[data-vis-ba]');
    bv.innerHTML = `<div class="ba-mini"><div><span class="chip">Original · ${fmtSec(normal.rset)}</span><canvas></canvas></div><div><span class="chip teal">Improved · ${fmtSec(best.result.rset)}</span><canvas></canvas></div></div>`;
    const cvs = bv.querySelectorAll('canvas');
    renderStaticPlan(cvs[0], createHall406(), { map: normal.peakMap, markers: normal.bottlenecks.slice(0, 2), openingLabels: false, labels: false, pad: 4 });
    import('../sim/layout.js').then(({ deserializeLayout }) => renderStaticPlan(cvs[1], deserializeLayout(best.layout), { map: best.result.peakMap, markers: best.result.bottlenecks.slice(0, 2), openingLabels: false, labels: false, pad: 4 }));
    const saved = (normal.rset - best.result.rset).toFixed(1);
    $('[data-ba-cap]').innerHTML = `<b>${esc(best.title)}</b> — ${saved} s faster (${fmtSec(normal.rset)} → ${fmtSec(best.result.rset)}), peak density ${normal.peakDensity.value.toFixed(2)} → ${best.result.peakDensity.value.toFixed(2)} p/m². 200 occupants, seed 406.`;
    $('[data-ba-open]').disabled = false;
  }

  $('[data-ba-open]').addEventListener('click', async () => {
    if (!baData) return;
    const { openModal } = await import('../ui/dom.js');
    const m = openModal({ title: 'Before / after redesign', wide: true, body: '<div class="cmp-host"></div>' });
    const stop = renderCompare(m.body.querySelector('.cmp-host'), baData);
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { stop(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  });

  // PNG downloads of the live/static visuals
  root.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => {
    const which = b.dataset.dl;
    const cv = root.querySelector(which === 'iso' ? '[data-vis-iso] canvas' : which === 'live' ? '[data-vis-live] canvas' : '[data-vis-heat] canvas');
    if (!cv) return;
    const a = document.createElement('a');
    a.download = `evacprint-${which}.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  }));

  return () => { cleanups.forEach((f) => f()); heroView?.destroy(); heroDriver.stop(); };
}
