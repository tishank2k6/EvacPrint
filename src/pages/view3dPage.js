import { controller as ctl } from '../sim/controller.js';
import { FloorPlan2D } from '../render/floorplan.js';
import { icon } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { densityLegend } from '../ui/compare.js';

export function mount(root) {
  root.innerHTML = `
  <div class="v3p">
    <div class="v3p-stage">
      <div class="v3p-canvas"><div class="loading3d"><span class="spinner"></span>Loading 3D model…</div></div>
      <div class="v3p-mini card" title="Same simulation, 2D plan">
        <div class="mini-h">Synchronized 2D plan</div>
        <div class="v3p-mini-plan"></div>
      </div>
    </div>
    <aside class="v3p-side">
      <div class="v3p-head">
        <span class="eyebrow">3D View · synchronized</span>
        <h1>${esc(ctl.layout.name)}</h1>
        <p class="muted">An architectural cutaway generated from the same 0.5 m grid as the 2D plan. Every figure is a live agent from the simulation engine — the 3D layer only draws what the engine computes.</p>
      </div>
      <div class="v3p-controls">
        <label class="field"><span class="label">Scenario</span>
          <select class="input" data-sc>${ctl.scenarios.map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(s.short)}</option>`).join('')}</select></label>
        <div class="row gap8">
          <button class="btn primary grow" data-play>${icon('play')}Run</button>
          <button class="btn icon" data-reset aria-label="Reset">${icon('reset')}</button>
          <div class="seg">${[1, 2, 4].map((v) => `<button data-speed="${v}" aria-pressed="false">${v}×</button>`).join('')}</div>
        </div>
        <div class="v3p-read mono"><span data-t>t = 0.0 s</span><span data-ev></span></div>
        <div class="progress"><i data-bar></i></div>
      </div>
      <div class="v3p-section">
        <div class="mini-h">What you are seeing</div>
        <ul class="keylist">
          <li><i class="k-agent" style="background:#8a857c"></i><span><b>Grey, seated</b> — reaction (pre-movement) time after the alarm</span></li>
          <li><i class="k-agent" style="background:#e9e2d4"></i><span><b>Warm white</b> — walking at free speed</span></li>
          <li><i class="k-agent" style="background:#e3a03a"></i><span><b>Amber</b> — reduced-mobility occupant (0.7–1.0 m/s)</span></li>
          <li><i class="k-agent wide" style="background:#8b9be0"></i><span><b>Blue, wider</b> — wheelchair user</span></li>
          <li><i class="k-agent" style="background:#f06d64"></i><span><b>Red</b> — slowed by congestion or queuing at a door</span></li>
          <li><i class="k-line"></i><span><b>Moving dashes</b> — planned route of sampled agents to their chosen exit</span></li>
          <li><i class="k-post teal"></i><span><b>Teal posts &amp; sign</b> — open exit · <b class="amber-t">amber</b> = queue ≥ 4 · <b class="red-t">red</b> = blocked</span></li>
          <li><i class="k-ring"></i><span><b>Red ring</b> — live bottleneck above 2.15 p/m² (Fruin LOS F)</span></li>
        </ul>
        ${densityLegend('Floor density')}
      </div>
      <div class="v3p-section">
        <div class="mini-h">Model</div>
        <div class="seg" role="group" aria-label="Wall style">
          <button data-walls="solid" aria-pressed="true">Cutaway walls</button>
          <button data-walls="glass" aria-pressed="false">Translucent</button>
        </div>
        <a class="btn ghost sm" href="#/simulator?view=split">${icon('split')}Open in Simulator (split view)</a>
      </div>
    </aside>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];

  const mini = new FloorPlan2D($('.v3p-mini-plan'), ctl, { compact: true, interactive: false, layers: { chips: false, bottlenecks: true } });
  let view = null;
  let glass = false;
  const build = async () => {
    const { View3D, webglAvailable } = await import('../render/view3d.js');
    const host = $('.v3p-canvas');
    view?.destroy();
    host.innerHTML = '';
    if (!webglAvailable()) {
      host.innerHTML = `<div class="loading3d">${icon('warning')}WebGL is unavailable here. The synchronized 2D plan is shown instead.</div>`;
      $('.v3p-mini').classList.add('fallback');
      mini.resize();
      return;
    }
    view = new View3D(host, ctl, { controls: true, toolbar: true, glassWalls: glass, wallHeight: glass ? 2.6 : 1.35 });
  };
  build();

  $('[data-sc]').value = ctl.scenarioId;
  $('[data-sc]').addEventListener('change', (e) => ctl.setScenario(e.target.value));
  $('[data-play]').addEventListener('click', () => ctl.toggle());
  $('[data-reset]').addEventListener('click', () => ctl.reset());
  $$('[data-speed]').forEach((b) => b.addEventListener('click', () => ctl.setSpeed(+b.dataset.speed)));
  $$('[data-walls]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-walls]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    glass = b.dataset.walls === 'glass';
    build();
  }));

  let last = 0;
  const sync = (force) => {
    const now = performance.now();
    if (!force && now - last < 150) return;
    last = now;
    const s = ctl.sim;
    $('[data-t]').textContent = `t = ${s.t.toFixed(1)} s · ${ctl.phase}`;
    $('[data-ev]').textContent = `${s.evacuated} / ${s.N} evacuated`;
    $('[data-bar]').style.width = `${s.N ? (s.evacuated / s.N) * 100 : 0}%`;
    $('[data-play]').innerHTML = ctl.running ? `${icon('pause')}Pause` : `${icon('play')}${s.done ? 'Run again' : s.t > 0 ? 'Resume' : 'Run'}`;
    $$('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === ctl.speed)));
    $('[data-sc]').value = ctl.scenarioId;
  };
  const unsub = ctl.subscribe((type) => { if (type === 'frame') sync(); else sync(true); });
  sync(true);
  const onKey = (e) => { if (e.code === 'Space' && !e.target.closest('input,select,textarea,button')) { e.preventDefault(); ctl.toggle(); } };
  document.addEventListener('keydown', onKey);

  return () => { unsub(); mini.destroy(); view?.destroy(); document.removeEventListener('keydown', onKey); };
}
