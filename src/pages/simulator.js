import { controller as ctl } from '../sim/controller.js';
import { T, CELL } from '../sim/layout.js';
import { STATE, MODEL, losFor, CATEGORY } from '../sim/engine.js';
import { FloorPlan2D } from '../render/floorplan.js';
import { lineChart, hBars } from '../render/charts.js';
import { icon } from '../ui/icons.js';
import { esc, toast, syncRange, fmtSec, openModal } from '../ui/dom.js';
import { renderCompare, densityLegend } from '../ui/compare.js';
import { saveReport, liteRec } from '../reports/store.js';
import { BAND, bandOf, BAND_LABEL, AGENT_COLORS } from '../render/colors.js';

const TOOLS = [
  { t: T.WALL, label: 'Wall' },
  { t: T.FLOOR, label: 'Floor' },
  { t: T.SEAT, label: 'Seat' },
  { t: T.OBST, label: 'Furniture' },
  { t: T.DOOR, label: 'Door' },
  { t: T.EXIT, label: 'Exit' },
];

export function mount(root, { query }) {
  if (query?.get('scenario')) ctl.setScenario(query.get('scenario'));
  root.innerHTML = `
  <div class="sim">
    <aside class="sim-left" aria-label="Scenario and parameters">
      <section class="sp">
        <div class="sp-h"><span class="eyebrow plain">Venue</span></div>
        <div class="venue" data-venue></div>
      </section>
      <section class="sp">
        <div class="sp-h"><span class="eyebrow plain">Scenario</span></div>
        <div class="scen" role="radiogroup" aria-label="Scenario">
          ${ctl.scenarios.map((s, i) => `<button role="radio" data-sc="${s.id}"><span class="scn">${i + 1}</span><b>${esc(s.name)}</b><em>${esc(s.summary)}</em></button>`).join('')}
        </div>
      </section>
      <section class="sp">
        <div class="sp-h"><span class="eyebrow plain">Occupancy</span><span class="faint small">live input</span></div>
        <div class="field"><div class="label"><span>Occupants</span><span class="val" data-v="occupants"></span></div><input type="range" min="20" max="400" step="10" data-p="occupants" aria-label="Occupants"></div>
        <div class="field"><div class="label"><span>Reduced mobility</span><span class="val" data-v="slowFraction"></span></div><input type="range" min="0" max="0.5" step="0.05" data-p="slowFraction" aria-label="Reduced mobility share"></div>
        <div class="field"><div class="label"><span>Wheelchair users</span><span class="val" data-v="wheelchairs"></span></div><input type="range" min="0" max="8" step="1" data-p="wheelchairs" aria-label="Wheelchair users"></div>
      </section>
      <section class="sp">
        <div class="sp-h"><span class="eyebrow plain">Behaviour</span></div>
        <div class="field"><div class="label"><span>Reaction time, min</span><span class="val" data-v="reactionMin"></span></div><input type="range" min="0" max="60" step="1" data-p="reactionMin" aria-label="Minimum reaction time"></div>
        <div class="field"><div class="label"><span>Reaction time, max</span><span class="val" data-v="reactionMax"></span></div><input type="range" min="0" max="90" step="1" data-p="reactionMax" aria-label="Maximum reaction time"></div>
        <div class="field"><div class="label"><span>Panic level</span><span class="val" data-v="panic"></span></div><input type="range" min="0" max="1" step="0.05" data-p="panic" aria-label="Panic level"><span class="hint" data-panic-hint></span></div>
        <div class="field"><div class="label"><span>Random seed</span></div><div class="seed"><input class="input mono" type="number" data-seed min="1" max="99999" aria-label="Random seed"><button class="btn sm" data-reseed title="New random seed">${icon('reset')}New</button></div></div>
      </section>
      <section class="sp">
        <div class="sp-h"><span class="eyebrow plain">Doors &amp; exits</span><span class="faint small">click to block</span></div>
        <div class="openings"></div>
      </section>
      <section class="sp">
        <div class="sp-h"><span class="eyebrow plain">Layout</span></div>
        <div class="mods"></div>
        <div class="row gap8"><button class="btn sm" data-edit>${icon('edit')}Edit layout</button><button class="btn sm ghost" data-resetlayout>${icon('reset')}Original</button></div>
      </section>
    </aside>

    <section class="sim-center">
      <div class="viewbar">
        <div class="seg" role="group" aria-label="View mode">
          <button data-mode="2d" aria-pressed="true">${icon('plan')}2D plan</button>
          <button data-mode="3d" aria-pressed="false">${icon('cube')}3D</button>
          <button data-mode="split" aria-pressed="false">${icon('split')}Split</button>
        </div>
        <div class="layer-toggles" role="group" aria-label="Layers">
          <button class="lt" data-layer="heat" aria-pressed="true">${icon('heat')}Density</button>
          <button class="lt" data-layer="flow" aria-pressed="false">${icon('arrows')}Routes</button>
          <button class="lt" data-layer="bottlenecks" aria-pressed="true">${icon('target')}Bottlenecks</button>
          <button class="lt" data-layer="chips" aria-pressed="true">${icon('door')}Exit status</button>
        </div>
      </div>
      <div class="editbar" hidden>
        <span class="faint small">Paint with:</span>
        <div class="seg" role="group" aria-label="Editor tool">${TOOLS.map((t, i) => `<button data-tool="${t.t}" aria-pressed="${i === 0}">${t.label}</button>`).join('')}</div>
        <span class="faint small hide-sm">Doors and exits must sit in a wall line. Editing resets the run.</span>
        <button class="btn sm primary" data-editdone>${icon('check')}Done</button>
      </div>
      <div class="viewport mode-2d">
        <div class="vp vp-2d"></div>
        <div class="vp vp-3d" hidden></div>
        <div class="vp-status">
          <span class="chip phase" data-phase></span>
          <span class="mono vp-clock" data-clock>t = 0.0 s</span>
        </div>
        <div class="vp-legend">
          ${densityLegend('Density')}
          <div class="alegend">
            <span><i style="background:${AGENT_COLORS.adult}"></i>Adult</span>
            <span><i style="background:${AGENT_COLORS.slow}"></i>Reduced mobility</span>
            <span><i style="background:${AGENT_COLORS.wheelchair}"></i>Wheelchair</span>
            <span><i style="background:${AGENT_COLORS.congested}"></i>Queuing</span>
            <span><i class="ring"></i>Reacting</span>
          </div>
        </div>
      </div>
      <div class="transport">
        <button class="btn primary play" data-play aria-label="Play">${icon('play')}<span>Run</span></button>
        <button class="btn icon" data-step title="Advance 1 s (S)" aria-label="Advance one second">${icon('step')}</button>
        <button class="btn icon" data-reset title="Reset (R)" aria-label="Reset">${icon('reset')}</button>
        <div class="seg speed" role="group" aria-label="Playback speed">${[1, 2, 4, 8].map((v) => `<button data-speed="${v}" aria-pressed="false">${v}×</button>`).join('')}</div>
        <div class="tprog">
          <div class="tp-row"><span data-evtext>0 / 0 evacuated</span><span class="faint mono" data-pct>0 %</span></div>
          <div class="progress"><i data-bar></i></div>
        </div>
      </div>
    </section>

    <aside class="sim-right" aria-label="Live metrics">
      <div class="kpis">
        <div class="kpi"><span>Elapsed</span><b class="num" data-k="t">0.0 s</b><em data-k="tsub">simulated</em></div>
        <div class="kpi"><span>Evacuated</span><b class="num" data-k="ev">0</b><em data-k="evsub">of 0</em></div>
        <div class="kpi"><span>Peak density</span><b class="num" data-k="pk">0.00</b><em data-k="pksub">p/m²</em></div>
        <div class="kpi"><span>Evacuation time</span><b class="num" data-k="rset">—</b><em data-k="rsetsub">RSET, last person out</em></div>
      </div>
      <div class="card rp">
        <div class="panel-title"><h3>${icon('users')}Evacuation curve</h3><span class="aside" data-curveaside></span></div>
        <div class="chart-host" data-curve></div>
      </div>
      <div class="card rp">
        <div class="panel-title"><h3>${icon('door')}Exit utilisation</h3><span class="aside">people through · capacity</span></div>
        <div class="chart-host pad-x" data-exits></div>
      </div>
      <div class="card rp">
        <div class="panel-title"><h3>${icon('target')}Bottlenecks</h3><span class="aside">≥ 2.15 p/m² (LOS F)</span></div>
        <div class="bn-list" data-bn></div>
      </div>
      <div class="card rp" data-riskcard hidden>
        <div class="panel-title"><h3>${icon('shield')}Risk analysis</h3><span class="aside">model estimate</span></div>
        <div class="risk-mini" data-risk></div>
      </div>
      <div class="card rp rec-card">
        <div class="panel-title"><h3>${icon('sparkle')}Recommendations</h3><span class="aside" data-recaside></span></div>
        <div class="rec-body" data-rec></div>
      </div>
      <div class="save-row">
        <button class="btn outline" data-compare hidden>${icon('compare')}Before / after</button>
        <button class="btn" data-save>${icon('report')}Save report</button>
      </div>
    </aside>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];

  // ------------------------------------------------------------- 2D view
  const plan = new FloorPlan2D($('.vp-2d'), ctl, {
    onPaint: (cells, tool) => {
      const changed = ctl.paint(cells, tool);
      if (changed) toast('Layout updated — distance fields recomputed', 'ok', 1800);
    },
  });
  let view3d = null;
  let loading3d = null;
  async function ensure3d() {
    if (view3d || loading3d) return loading3d;
    const host = $('.vp-3d');
    host.innerHTML = `<div class="loading3d"><span class="spinner"></span>Loading 3D model…</div>`;
    loading3d = import('../render/view3d.js').then(({ View3D, webglAvailable }) => {
      host.innerHTML = '';
      if (!webglAvailable()) {
        host.innerHTML = `<div class="loading3d">${icon('warning')}WebGL is not available in this browser — showing the 2D plan instead.</div>`;
        return null;
      }
      view3d = new View3D(host, ctl, { controls: true, toolbar: true });
      return view3d;
    });
    return loading3d;
  }

  function setMode(m) {
    $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    const vp = $('.viewport');
    vp.className = `viewport mode-${m}`;
    $('.vp-2d').hidden = m === '3d';
    $('.vp-3d').hidden = m === '2d';
    if (m !== '2d') ensure3d().then(() => view3d?.resize());
    requestAnimationFrame(() => { plan.resize(); view3d?.resize(); });
    try { localStorage.setItem('ep.simMode', m); } catch { /* ignore */ }
  }
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  let startMode = 'split';
  try { startMode = localStorage.getItem('ep.simMode') || (window.innerWidth > 1400 ? 'split' : '2d'); } catch { /* ignore */ }
  if (query?.get('view')) startMode = query.get('view');
  setMode(startMode);

  $$('[data-layer]').forEach((b) =>
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      plan.setLayer(b.dataset.layer, on);
      view3d?.setLayer?.(b.dataset.layer, on);
    }),
  );

  // ------------------------------------------------------------- controls
  const fmt = {
    occupants: (v) => `${v}`,
    slowFraction: (v) => `${Math.round(v * 100)} %`,
    wheelchairs: (v) => `${v}`,
    reactionMin: (v) => `${v} s`,
    reactionMax: (v) => `${v} s`,
    panic: (v) => `${(+v).toFixed(2)}`,
  };
  const panicHint = (v) => (v < 0.15 ? 'Calm, orderly egress.' : v < 0.45 ? 'Mild urgency: slightly faster walking, faster reactions.' : v < 0.75 ? 'Hurried: less rerouting, pushing at doors reduces discharge.' : 'Panic: herding and clogging at exits (faster-is-slower).');

  function syncControls() {
    const p = ctl.params;
    $$('[data-p]').forEach((inp) => {
      inp.value = p[inp.dataset.p];
      syncRange(inp);
      $(`[data-v="${inp.dataset.p}"]`).textContent = fmt[inp.dataset.p](p[inp.dataset.p]);
    });
    $('[data-panic-hint]').textContent = panicHint(p.panic);
    $('[data-seed]').value = p.seed;
    $$('[data-sc]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sc === ctl.scenarioId)));
    renderOpenings();
    renderMods();
    renderVenue();
  }
  $$('[data-p]').forEach((inp) => {
    inp.addEventListener('input', () => {
      syncRange(inp);
      $(`[data-v="${inp.dataset.p}"]`).textContent = fmt[inp.dataset.p](inp.value);
      if (inp.dataset.p === 'panic') $('[data-panic-hint]').textContent = panicHint(+inp.value);
    });
    inp.addEventListener('change', () => {
      const k = inp.dataset.p;
      const patch = { [k]: +inp.value };
      if (k === 'reactionMin' && +inp.value > ctl.params.reactionMax) patch.reactionMax = +inp.value;
      if (k === 'reactionMax' && +inp.value < ctl.params.reactionMin) patch.reactionMin = +inp.value;
      ctl.setParams(patch);
      syncControls();
    });
  });
  $('[data-seed]').addEventListener('change', (e) => { const v = Math.max(1, Math.min(99999, Math.round(+e.target.value || 1))); ctl.setParams({ seed: v }); syncControls(); });
  $('[data-reseed]').addEventListener('click', () => { ctl.setParams({ seed: 1 + Math.floor(Math.random() * 99998) }); syncControls(); });
  $$('[data-sc]').forEach((b) =>
    b.addEventListener('click', () => {
      ctl.setScenario(b.dataset.sc);
      syncControls();
      toast(`Scenario: ${ctl.scenarios.find((s) => s.id === b.dataset.sc).name}`, 'info', 1600);
    }),
  );

  function renderOpenings() {
    const groups = ctl.sim.c.groups.slice().sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'door' ? -1 : 1));
    $('.openings').innerHTML = groups
      .map((g) => `<button class="op ${g.blocked ? 'blocked' : ''}" data-op="${esc(g.name)}" aria-pressed="${!g.blocked}">
        <span class="op-ic">${icon(g.type === 'exit' ? 'exit' : 'door')}</span>
        <span class="op-n"><b>${esc(g.name)}</b><em>${g.type === 'exit' ? 'Final exit' : 'Hall door'} · ${g.widthM.toFixed(1)} m · ${(g.widthM * MODEL.specificFlow).toFixed(2)} p/s</em></span>
        <span class="op-s">${g.blocked ? 'Blocked' : 'Open'}</span></button>`)
      .join('');
    $$('[data-op]').forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.op;
      const g = ctl.sim.c.groups.find((x) => x.name === name);
      if (!g.blocked && ctl.sim.c.exits.length <= 1 && g.type === 'exit') { toast('At least one final exit must stay open.', 'warn'); return; }
      ctl.toggleBlocked(name);
      renderOpenings();
      toast(`${name} ${g.blocked ? 'reopened' : 'blocked'} — routes recomputed`, g.blocked ? 'ok' : 'warn', 1800);
    }));
  }
  function renderVenue() {
    const v = ctl.venue;
    const el = $('[data-venue]');
    if (!v) {
      el.innerHTML = `<div class="venue-t"><strong>${esc(ctl.layout.name)}</strong><span class="faint mono">21.0 × 15.0 m · 0.5 m grid</span></div>
        <p class="faint small">Representative model of MSIT Seminar Hall 406. Verify dimensions on site before relying on absolute times.</p>
        <a class="btn sm ghost" href="#/venues">${icon('building')}Use your own venue</a>`;
      return;
    }
    el.innerHTML = `<div class="venue-t"><strong>${esc(v.name)}</strong><span class="faint mono">Venue Studio · ${ctl.sim.N} people${v.scaleVerified ? '' : ' · unverified dimensions'}</span></div>
      <p class="faint small">Configured population, exits and conditions are applied. The scenario cards below switch back to Hall 406.</p>
      <div class="row gap8 wrap-row"><a class="btn sm" href="#/venues/${v.id}">${icon('edit')}Edit venue</a><button class="btn sm ghost" data-unload>${icon('arrowLeft')}Hall 406</button></div>`;
    el.querySelector('[data-unload]').addEventListener('click', () => { ctl.unloadVenue(); syncControls(); toast('Back to Seminar Hall 406', 'ok', 1600); });
  }

  function renderRisk() {
    const card = $('[data-riskcard]');
    const risk = ctl.result?.risk;
    card.hidden = !risk;
    if (!risk) return;
    $('[data-risk]').innerHTML = risk.length
      ? `<ol class="risk-list compact">${risk.slice(0, 6).map((f, i) => `<li class="risk ${f.severity}" data-ri="${i}" tabindex="0" role="button"><span class="rk">${i + 1}</span><div><b>${esc(f.title)}</b><p>${esc(f.detail)}</p></div></li>`).join('')}</ol><p class="faint small" style="padding:0 14px 12px">Model estimate for comparing designs — not a verified safety assessment. Select a finding to locate it.</p>`
      : '<p class="empty">No risks flagged for this run.</p>';
    $('[data-risk]').querySelectorAll('[data-ri]').forEach((li) => {
      const f = risk[+li.dataset.ri];
      const go = () => ctl.highlight({ x: f.x, y: f.y, radius: f.radius, label: `${+li.dataset.ri + 1} · ${f.title}` });
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  function renderMods() {
    const m = ctl.layout.modifications;
    $('.mods').innerHTML = m.length
      ? `<ul class="modlist">${m.map((t) => `<li>${icon('check')}${esc(t)}</li>`).join('')}</ul>`
      : `<p class="faint small">Original layout — no design changes applied.</p>`;
  }

  // editor
  function setEditing(on) {
    $('.editbar').hidden = !on;
    plan.editTool = on ? +$('[data-tool][aria-pressed="true"]').dataset.tool : null;
    $('.viewport').classList.toggle('editing', on);
    if (on) { ctl.reset(); setMode('2d'); }
  }
  $('[data-edit]').addEventListener('click', () => setEditing(true));
  $('[data-editdone]').addEventListener('click', () => setEditing(false));
  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    plan.editTool = +b.dataset.tool;
  }));
  $('[data-resetlayout]').addEventListener('click', () => { ctl.resetLayout(); syncControls(); toast('Original Hall 406 layout restored', 'ok', 1600); });

  // transport
  $('[data-play]').addEventListener('click', () => ctl.toggle());
  $('[data-step]').addEventListener('click', () => ctl.stepOnce());
  $('[data-reset]').addEventListener('click', () => ctl.reset());
  $$('[data-speed]').forEach((b) => b.addEventListener('click', () => ctl.setSpeed(+b.dataset.speed)));

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return;
    if (e.code === 'Space') { e.preventDefault(); ctl.toggle(); }
    else if (e.key === 'r' || e.key === 'R') ctl.reset();
    else if (e.key === 's' || e.key === 'S') ctl.stepOnce();
    else if (e.key === '1') setMode('2d');
    else if (e.key === '2') setMode('3d');
    else if (e.key === '3') setMode('split');
  };
  document.addEventListener('keydown', onKey);

  // ------------------------------------------------------------- live panels
  function renderTransport() {
    const run = ctl.running;
    const btn = $('[data-play]');
    btn.innerHTML = run ? `${icon('pause')}<span>Pause</span>` : `${icon('play')}<span>${ctl.sim.done ? 'Run again' : ctl.sim.t > 0 ? 'Resume' : 'Run'}</span>`;
    btn.setAttribute('aria-label', run ? 'Pause' : 'Run');
    btn.classList.toggle('running', run);
    $$('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === ctl.speed)));
  }

  let lastPanel = 0;
  let curveKey = '';
  function renderLive(force = false) {
    const now = performance.now();
    if (!force && now - lastPanel < 200) return;
    lastPanel = now;
    const sim = ctl.sim;
    const N = sim.N;
    const pct = N ? (sim.evacuated / N) * 100 : 0;
    $('[data-clock]').textContent = `t = ${sim.t.toFixed(1)} s`;
    const ph = ctl.phase;
    const pe = $('[data-phase]');
    pe.textContent = ph;
    pe.className = `chip phase ${ph === 'Alarm' ? 'red' : ph === 'Complete' ? 'teal' : ph === 'Ready' ? '' : 'amber'}`;
    $('[data-evtext]').textContent = `${sim.evacuated} / ${N} evacuated`;
    $('[data-pct]').textContent = `${pct.toFixed(0)} %`;
    $('[data-bar]').style.width = `${pct}%`;
    $('[data-k="t"]').textContent = `${sim.t.toFixed(1)} s`;
    $('[data-k="tsub"]').textContent = ctl.running ? `running at ${ctl.speed}×` : sim.done ? 'run complete' : 'paused';
    $('[data-k="ev"]').textContent = sim.evacuated;
    $('[data-k="evsub"]').textContent = `of ${N}${sim.trapped ? ` · ${sim.trapped} trapped` : ''}`;
    const pk = sim.peak.value;
    const b = bandOf(pk);
    $('[data-k="pk"]').innerHTML = `${pk.toFixed(2)}<i class="pk-dot" style="background:${BAND[b]}"></i>`;
    $('[data-k="pksub"]').textContent = pk > 0 ? `p/m² · ${BAND_LABEL[b]} · LOS ${losFor(pk)}` : 'p/m² · peak so far';
    const r = ctl.result;
    if (r) {
      $('[data-k="rset"]').textContent = r.rset != null ? `${r.rset.toFixed(1)} s` : 'Incomplete';
      $('[data-k="rsetsub"]').textContent = r.rset != null ? `95 % out at ${r.t95.toFixed(1)} s` : `${r.trapped} could not reach an exit`;
    } else {
      $('[data-k="rset"]').textContent = '—';
      $('[data-k="rsetsub"]').textContent = 'RSET, last person out';
    }

    // curve
    const key = `${sim.curve.length}|${ctl.previous?.finishedAt || 0}`;
    if (key !== curveKey || force) {
      curveKey = key;
      const series = [];
      const prev = ctl.previous;
      if (prev && prev.occupants === N) series.push({ name: `Previous run${prev.rset ? ` (${prev.rset.toFixed(0)} s)` : ''}`, color: 'var(--s-chart-base)', points: prev.curve.map((p) => [p.t, p.evacuated]), dash: true, endDot: false });
      series.push({ name: 'Current run', color: 'var(--s-chart-a)', points: sim.curve.map((p) => [p.t, p.evacuated]), area: true });
      lineChart($('[data-curve]'), series, { yMax: Math.max(10, N), height: 150, xMax: Math.max(60, sim.t, prev?.simulatedTime || 0), label: 'People evacuated over time', tipFmt: (v) => `${v} out` });
      $('[data-curveaside]').textContent = `${N} occupants`;
    }

    // exits
    const groups = sim.c.groups.slice().sort((a, b2) => (a.type === b2.type ? a.name.localeCompare(b2.name) : a.type === 'door' ? -1 : 1));
    hBars($('[data-exits]'), groups.map((g) => {
      const n = sim.gatePasses[g.id].length;
      const q = sim.gateQueue[g.id];
      return {
        label: g.name,
        sub: g.type === 'exit' ? 'exit' : 'door',
        value: n,
        max: N,
        muted: g.blocked,
        color: g.blocked ? 'var(--red)' : g.type === 'exit' ? 'var(--s-chart-a)' : 'var(--s-chart-b)',
        note: g.blocked ? 'blocked' : `${n}${q ? ` · q${q}` : ''}`,
        tip: `<div class="t-h">${esc(g.name)}</div>
          <div class="t-row"><span>Through so far</span><span>${n} (${N ? Math.round((n / N) * 100) : 0} %)</span></div>
          <div class="t-row"><span>Queue now</span><span>${q}</span></div>
          <div class="t-row"><span>Clear width</span><span>${g.widthM.toFixed(1)} m</span></div>
          <div class="t-row"><span>Max discharge</span><span>${(g.widthM * MODEL.specificFlow).toFixed(2)} p/s</span></div>`,
      };
    }), { max: Math.max(1, N) });

    // bottlenecks
    const bns = sim.done && ctl.result ? ctl.result.bottlenecks : sim.liveBottlenecks;
    $('[data-bn]').innerHTML = bns.length
      ? bns.slice(0, 4).map((bn, k) => `<div class="bn"><span class="bn-id">B${k + 1}</span><div class="bn-t"><b>${esc(bn.label)}</b><em>${sim.done ? `peak ${bn.peak.toFixed(2)} p/m² · ${bn.exposure.toFixed(0)} cell·s at LOS F` : `${bn.areaM2.toFixed(2)} m² · peak ${bn.peak.toFixed(2)} p/m²`}</em></div><span class="bn-sw" style="background:${BAND[bandOf(bn.peak)]}"></span></div>`).join('')
      : `<p class="empty">${sim.t === 0 ? 'Run the simulation to detect congestion.' : sim.done ? 'No sustained congestion above LOS F.' : 'No area currently above 2.15 p/m².'}</p>`;
  }

  // ------------------------------------------------------------- recommendations
  function renderRecs() {
    const host = $('[data-rec]');
    const r = ctl.recs;
    $('[data-recaside]').textContent = '';
    if (!r) {
      host.innerHTML = `<p class="faint small">Tests every applicable design change — widening doors, clearing obstructions, adding an exit, removing seats — with full re-simulations on 3 seeds, then ranks them by evacuation time saved.</p>
        <button class="btn amber wide" data-suggest>${icon('sparkle')}Suggest improvements</button>`;
      host.querySelector('[data-suggest]').addEventListener('click', async () => {
        ctl.pause();
        await ctl.recommend();
      });
      return;
    }
    if (r.status === 'running') {
      host.innerHTML = `<div class="rec-run"><div class="row gap8"><span class="spinner"></span><b>Running ${r.total || '…'} simulations</b><span class="faint mono">${r.done}/${r.total || '?'}</span></div>
        <div class="progress"><i style="width:${r.total ? (r.done / r.total) * 100 : 3}%"></i></div><span class="faint small">${esc(r.label || 'Preparing candidate layouts')}</span></div>`;
      return;
    }
    if (r.status === 'error') {
      host.innerHTML = `<div class="callout red">${icon('warning')}<span>Recommendation run failed: ${esc(r.message)}</span></div><button class="btn wide" data-retry>Retry</button>`;
      host.querySelector('[data-retry]').addEventListener('click', () => ctl.recommend());
      return;
    }
    $('[data-recaside]').textContent = `${r.runs} runs · ${(r.ms / 1000).toFixed(1)} s`;
    const worst = r.baseline.result.bottlenecks[0];
    host.innerHTML = `
      <div class="rec-base"><span>Baseline (mean of 3 seeds)</span><b class="mono">${r.baseline.meanRset.toFixed(1)} s</b></div>
      ${worst ? `<div class="rec-worst">${icon('target')}<span>Worst bottleneck: <b>${esc(worst.label)}</b>, peak ${worst.peak.toFixed(2)} p/m²</span></div>` : ''}
      <ol class="rec-list">${r.items.map((it, k) => `
        <li class="rec ${it.significant ? '' : 'weak'}">
          <div class="rec-top"><span class="rec-rank">${k + 1}</span><b>${esc(it.title)}</b></div>
          <div class="rec-meta">
            ${it.complete === false ? '<span class="rec-saved neg">leaves people behind</span>' : `<span class="rec-saved ${it.saved > 0 ? 'pos' : 'neg'}">${it.saved > 0 ? '−' : '+'}${Math.abs(it.saved).toFixed(1)} s</span>`}
            <span class="faint mono small">${it.savedMin.toFixed(1)} to ${it.savedMax.toFixed(1)} s · peak ${it.peakDelta > 0 ? '+' : ''}${it.peakDelta.toFixed(2)} p/m²</span>
          </div>
          <div class="rec-tags">${it.significant ? `<span class="chip teal">${icon('check')}Helps on every seed</span>` : `<span class="chip">Within run-to-run noise</span>`}${it.targetsWorst ? `<span class="chip amber">${icon('target')}Targets worst bottleneck</span>` : ''}</div>
          <details class="rec-det"><summary>Details</summary><dl><div><dt>Original</dt><dd class="mono">${fmtSec(r.baseline.result.rset)}</dd></div><div><dt>Modified</dt><dd class="mono">${it.complete === false ? 'incomplete' : fmtSec(it.result?.rset)}</dd></div><div><dt>Peak density Δ</dt><dd class="mono">${it.peakDelta > 0 ? '+' : ''}${it.peakDelta.toFixed(2)} p/m²</dd></div><div><dt>Exit use</dt><dd>${(it.exitDiff || []).filter((d) => d.before !== d.after).map((d) => `${esc(d.name)} ${d.before ?? 'new'}→${d.after}`).join(', ') || 'unchanged'}</dd></div>${it.tradeoff ? `<div><dt>Trade-off</dt><dd>${esc(it.tradeoff)}</dd></div>` : ''}</dl></details>
          ${it.significant && k < 5 ? `<button class="btn sm" data-apply="${k}">${icon('compare')}Apply &amp; compare</button>` : ''}
        </li>`).join('')}</ol>
      <button class="btn ghost sm" data-rerun>${icon('reset')}Re-run analysis</button>`;
    host.querySelectorAll('[data-apply]').forEach((b) => b.addEventListener('click', () => {
      const it = r.items[+b.dataset.apply];
      ctl.applyRecommendation(it);
      syncControls();
      showCompare();
      toast(`Applied: ${it.title}. Press Run to watch the improved layout.`, 'ok', 3600);
    }));
    host.querySelector('[data-rerun]').addEventListener('click', () => ctl.recommend());
  }

  let compareCleanup = null;
  function showCompare() {
    if (!ctl.compare) return;
    const m = openModal({ title: 'Before / after redesign', wide: true, body: '<div class="cmp-host"></div>', onClose: () => compareCleanup?.() });
    compareCleanup = renderCompare(m.body.querySelector('.cmp-host'), ctl.compare);
  }
  $('[data-compare]').addEventListener('click', showCompare);

  // ------------------------------------------------------------- save report
  $('[data-save]').addEventListener('click', () => {
    const res = ctl.result;
    if (!res) { toast('Run the simulation to completion first — reports only contain finished runs.', 'warn'); return; }
    const sc = ctl.scenarios.find((s) => s.id === ctl.scenarioId) || { id: 'custom', name: ctl.venue ? 'Custom venue scenario' : 'Custom' };
    const recs = ctl.recs?.status === 'done' ? { baseline: ctl.recs.baseline.meanRset, items: ctl.recs.items.map(liteRec), runs: ctl.recs.runs } : null;
    const rep = saveReport({
      title: `${res.layoutName} — ${sc.name}`,
      scenario: sc.name,
      scenarioId: sc.id,
      result: res,
      recs,
      compare: ctl.compare,
      venue: ctl.venue ? { ...ctl.venue, risk: res.risk, profiles: res.profileStats } : null,
    });
    toast('Report saved', 'ok');
    location.hash = `/reports/${rep.id}`;
  });

  function onState() {
    renderTransport();
    $('[data-compare]').hidden = !ctl.compare;
    $('[data-save]').disabled = false;
    $('[data-save]').classList.toggle('primary', !!ctl.result);
  }

  const unsub = ctl.subscribe((type) => {
    if (type === 'frame') renderLive();
    else if (type === 'state') onState();
    else if (type === 'reset' || type === 'layout' || type === 'done') { renderLive(true); onState(); renderRecs(); syncControls(); renderRisk(); if (type !== 'done') ctl.highlight(null); }
    else if (type === 'params') syncControls();
    else if (type === 'recs') renderRecs();
    else if (type === 'compare') onState();
    if (type === 'done') {
      const r = ctl.result;
      toast(r.complete ? `Evacuation complete in ${r.rset.toFixed(1)} s — worst bottleneck: ${r.bottlenecks[0]?.label || 'none'}` : `${r.trapped} occupants could not reach an exit`, r.complete ? 'ok' : 'warn', 4200);
    }
  });

  syncControls();
  onState();
  renderLive(true);
  renderRecs();

  return () => {
    unsub();
    document.removeEventListener('keydown', onKey);
    plan.destroy();
    view3d?.destroy();
    compareCleanup?.();
  };
}
