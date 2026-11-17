import { listReports, getReport, deleteReport, saveReport, liteRec } from '../reports/store.js';
import { deserializeLayout, createHall406, cloneLayout } from '../sim/layout.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { renderStaticPlan } from '../render/floorplan.js';
import { lineChart } from '../render/charts.js';
import { renderCompare, densityLegend } from '../ui/compare.js';
import { icon } from '../ui/icons.js';
import { esc, fmtSec, toast, openModal } from '../ui/dom.js';
import { BAND, bandOf, BAND_LABEL } from '../render/colors.js';
import { currentUser } from '../auth/auth.js';

export function mount(root, { id }) {
  return id ? detail(root, id) : list(root);
}

function list(root) {
  const reps = listReports();
  root.innerHTML = `
  <div class="wrap">
    <header class="page-head row-head">
      <div><span class="eyebrow">Reports</span><h1>Evacuation reports</h1><p>Saved runs for ${esc(currentUser().name)}. Each report contains the full measured result, detected bottlenecks and — if you ran the analysis — ranked recommendations and a before/after comparison.</p></div>
    </header>
    <div class="rep-actions card pad">
      <div><h3>${icon('sparkle')}Generate a complete sample report</h3><p class="muted small">Runs the <b>Blocked exit</b> scenario, the full recommendation analysis (all candidate changes × 3 seeds) and a before/after comparison of the best fix. Takes a few seconds; every number comes from those runs.</p></div>
      <div class="rep-gen"><button class="btn amber" data-gen>${icon('play')}Generate</button><div class="progress" hidden><i></i></div><span class="faint small mono" data-genlabel></span></div>
    </div>
    <div class="rep-list">${reps.length ? reps.map(card).join('') : `<div class="empty-state card">${icon('report')}<h3>No saved reports yet</h3><p class="muted">Run a scenario to completion in the simulator and press “Save report”, or generate a sample above.</p><a class="btn primary" href="#/simulator">${icon('simulator')}Open simulator</a></div>`}</div>
  </div>`;
  root.querySelectorAll('canvas[data-thumb]').forEach((cv) => {
    const r = getReport(cv.dataset.thumb);
    if (r) renderStaticPlan(cv, deserializeLayout(r.result.layout), { map: r.result.peakMap, markers: r.result.bottlenecks.slice(0, 2), labels: false, openingLabels: false, pad: 4 });
  });
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    confirmDelete(b.dataset.del, () => mount(root, {}));
  }));
  root.querySelector('[data-gen]').addEventListener('click', () => generateSample(root));
}

function card(r) {
  const res = r.result;
  const best = r.recs?.items?.find((i) => i.significant);
  return `<a class="rep-card card" href="#/reports/${r.id}">
    <div class="rep-thumb"><canvas data-thumb="${r.id}"></canvas></div>
    <div class="rep-body">
      <div class="row between"><span class="mono faint small">${new Date(r.createdAt).toLocaleString()}</span><button class="btn ghost sm icon" data-del="${r.id}" aria-label="Delete report">${icon('trash')}</button></div>
      <h3>${esc(r.title)}</h3>
      <div class="rep-kpis"><span><b class="mono">${fmtSec(res.rset)}</b> RSET</span><span><b class="mono">${res.occupants}</b> people</span><span><i class="pk-dot" style="background:${BAND[bandOf(res.peakDensity.value)]}"></i><b class="mono">${res.peakDensity.value.toFixed(2)}</b> p/m² peak</span></div>
      ${res.modifications.length ? `<p class="small muted">Layout: ${esc(res.modifications.join(' · '))}</p>` : ''}
      ${best ? `<p class="small"><span class="chip teal">${icon('sparkle')}Top fix</span> ${esc(best.title)} <b class="mono">−${best.saved.toFixed(1)} s</b></p>` : ''}
    </div>
  </a>`;
}

function confirmDelete(id, after) {
  const m = openModal({ title: 'Delete this report?', body: `<div class="pad stack"><p class="muted">The report will be permanently removed from this browser. This cannot be undone.</p><div class="row gap8"><button class="btn" data-close>Cancel</button><button class="btn danger" data-ok>${icon('trash')}Delete</button></div></div>` });
  m.body.querySelector('[data-ok]').addEventListener('click', () => { deleteReport(id); m.close(); toast('Report deleted', 'ok'); after(); });
}

async function generateSample(root) {
  const btn = root.querySelector('[data-gen]');
  const bar = root.querySelector('.rep-gen .progress');
  const lab = root.querySelector('[data-genlabel]');
  btn.disabled = true;
  bar.hidden = false;
  const sc = SCENARIOS.find((s) => s.id === 'blocked');
  const layout = cloneLayout(createHall406());
  layout.blocked = [...sc.blocked];
  const params = { ...sc.params, seed: 406, maxTime: 600 };
  try {
    const { runRecommendations } = await import('../sim/recommend.js');
    const recs = await runRecommendations(layout, params, (d, t, label) => {
      bar.firstElementChild.style.width = `${(d / t) * 100}%`;
      lab.textContent = `${d}/${t} · ${label}`;
    });
    const base = recs.baseline.result;
    base.layout = (await import('../sim/layout.js')).serializeLayout(layout);
    const top = recs.items.find((i) => i.significant) || recs.items[0];
    const compare = { title: top.title, before: { result: base, layout: base.layout, meanRset: recs.baseline.meanRset }, after: { result: top.result, layout: top.layout, meanRset: top.meanRset }, saved: top.saved, savedMin: top.savedMin, savedMax: top.savedMax };
    const rep = saveReport({ title: `${base.layoutName} — ${sc.name}`, scenario: sc.name, scenarioId: sc.id, result: base, recs: { baseline: recs.baseline.meanRset, items: recs.items.map(liteRec), runs: recs.runs }, compare });
    toast(`Sample report generated from ${recs.runs} simulations`, 'ok');
    location.hash = `/reports/${rep.id}`;
  } catch (e) {
    console.error(e);
    toast(`Could not generate the report: ${e.message || e}`, 'err');
    btn.disabled = false;
  }
}

function detail(root, id) {
  const r = getReport(id);
  if (!r) {
    root.innerHTML = `<div class="wrap"><div class="empty-state card" style="margin-top:60px">${icon('report')}<h3>Report not found</h3><p class="muted">It may have been deleted, or it belongs to another account in this browser.</p><a class="btn" href="#/reports">${icon('arrowLeft')}All reports</a></div></div>`;
    return;
  }
  const res = r.result;
  const p = res.params;
  const worst = res.bottlenecks[0];
  const items = r.recs?.items || [];
  const top3 = items.filter((i) => i.significant).slice(0, 3);
  const exitsOnly = res.groups.filter((g) => g.type === 'exit');
  const summary = res.complete
    ? `${res.occupants} occupants evacuated ${esc(res.layoutName)} in <b>${fmtSec(res.rset)}</b>; 95 % were out after ${fmtSec(res.t95)}. ${worst ? `The worst bottleneck formed at <b>${esc(worst.label)}</b>, where density peaked at ${worst.peak.toFixed(2)} p/m² (${BAND_LABEL[bandOf(worst.peak)].toLowerCase()}, Fruin LOS ${worst.peak >= 2.15 ? 'F' : 'E'}).` : 'No sustained bottleneck above LOS F was detected.'} ${top3.length ? `The most effective tested change — <b>${esc(top3[0].title)}</b> — saves ${top3[0].saved.toFixed(1)} s on average (${top3[0].savedMin.toFixed(1)}–${top3[0].savedMax.toFixed(1)} s across 3 seeds).` : ''}`
    : `${res.trapped} of ${res.occupants} occupants could not reach an exit within ${res.params.maxTime} s. Check blocked exits and enclosed areas before relying on this layout.`;

  root.innerHTML = `
  <div class="wrap report">
    <div class="rep-bar no-print"><a class="btn ghost sm" href="#/reports">${icon('arrowLeft')}All reports</a><div class="row gap8"><button class="btn sm" data-print>${icon('print')}Print / save PDF</button><button class="btn sm danger" data-del>${icon('trash')}Delete</button></div></div>
    <header class="rep-head">
      <div><span class="eyebrow">Evacuation report · ${new Date(r.createdAt).toLocaleDateString()}</span><h1>${esc(r.title)}</h1>
      <p class="muted">${esc(res.layoutName)} · ${esc(r.scenario)} · ${res.occupants} occupants · seed ${p.seed}${res.modifications.length ? ` · layout changes: ${esc(res.modifications.join('; '))}` : ''}</p></div>
      <div class="rep-brand mono faint">EvacPrint · prepared for ${esc(currentUser().name)}</div>
    </header>
    <section class="rep-summary card pad"><h3>Summary</h3><p>${summary}</p></section>
    ${r.venue ? venueSection(r.venue, res) : ''}
    <section class="rep-kpis-row">
      <div class="kpi"><span>Evacuation time (RSET)</span><b class="num">${fmtSec(res.rset)}</b><em>last person out</em></div>
      <div class="kpi"><span>95 % evacuated</span><b class="num">${fmtSec(res.t95)}</b><em>50 % at ${fmtSec(res.t50)}</em></div>
      <div class="kpi"><span>Peak density</span><b class="num">${res.peakDensity.value.toFixed(2)}<i class="pk-dot" style="background:${BAND[bandOf(res.peakDensity.value)]}"></i></b><em>p/m² · LOS ${res.peakDensity.los} · ${esc(res.peakDensity.label)}</em></div>
      <div class="kpi"><span>Mean time queuing</span><b class="num">${fmtSec(res.meanQueue)}</b><em>mean walk ${fmtSec(res.meanTravel)}</em></div>
    </section>
    <section class="rep-grid">
      <figure class="card pad"><div class="mini-h">Peak density and bottlenecks</div><div class="rep-plan"><canvas data-plan></canvas></div>${densityLegend('Peak density reached')}</figure>
      <div class="card pad"><div class="mini-h">Evacuation curve</div><div data-curve></div>
        <div class="mini-h mt">Exits</div>
        <table class="ptable compact"><thead><tr><th>Opening</th><th>Width</th><th>People</th><th>Share</th><th>Peak flow</th></tr></thead><tbody>
        ${res.groups.map((g) => `<tr class="${g.blocked ? 'blocked-row' : ''}"><td>${esc(g.name)} <span class="faint small">${g.type}</span></td><td class="mono">${g.widthM.toFixed(1)} m</td><td class="mono">${g.blocked ? 'blocked' : g.count}</td><td class="mono">${g.blocked ? '—' : Math.round(g.share * 100) + ' %'}</td><td class="mono">${g.blocked ? '—' : `${g.peakFlow.toFixed(2)} / ${g.capacity.toFixed(2)} p/s`}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </section>
    <section class="card pad">
      <div class="mini-h">Detected bottlenecks</div>
      ${res.bottlenecks.length ? `<table class="ptable compact"><thead><tr><th>#</th><th>Location</th><th>Area</th><th>Peak density</th><th>Exposure (cell·s ≥ LOS F)</th></tr></thead><tbody>${res.bottlenecks.map((b, k) => `<tr><td class="mono">B${k + 1}</td><td>${esc(b.label)}</td><td class="mono">${b.areaM2.toFixed(2)} m²</td><td class="mono"><i class="pk-dot" style="background:${BAND[bandOf(b.peak)]}"></i>${b.peak.toFixed(2)} p/m²</td><td class="mono">${b.exposure.toFixed(0)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sustained zone above 2.15 p/m².</p>'}
    </section>
    ${items.length ? `<section class="card pad">
      <div class="mini-h">Recommendations — ${r.recs.runs} simulations, baseline mean ${r.recs.baseline.toFixed(1)} s</div>
      ${top3.length ? `<ol class="top3">${top3.map((it, k) => `<li><span class="rec-rank">${k + 1}</span><div><b>${esc(it.title)}</b><p class="muted small">${esc(it.detail)}</p></div><span class="rec-saved pos">−${it.saved.toFixed(1)} s</span></li>`).join('')}</ol>` : '<p class="muted">No tested change improved evacuation on every seed.</p>'}
      <table class="ptable compact"><thead><tr><th>Change</th><th>Mean saved</th><th>Range (3 seeds)</th><th>Peak density Δ</th><th>Verdict</th></tr></thead><tbody>
      ${items.map((it) => `<tr><td>${esc(it.title)}</td><td class="mono">${it.saved > 0 ? '−' : '+'}${Math.abs(it.saved).toFixed(1)} s</td><td class="mono">${it.savedMin.toFixed(1)} … ${it.savedMax.toFixed(1)} s</td><td class="mono">${it.peakDelta > 0 ? '+' : ''}${it.peakDelta.toFixed(2)}</td><td>${it.significant ? '<span class="chip teal">consistent gain</span>' : '<span class="chip">within noise</span>'}</td></tr>`).join('')}
      </tbody></table>
    </section>` : `<section class="callout no-print">${icon('info')}<span>This report has no recommendation analysis. In the simulator, press <b>Suggest improvements</b> before saving to include ranked fixes.</span></section>`}
    ${r.compare ? `<section class="card pad"><div class="mini-h">Before / after</div><div data-cmp></div></section>` : ''}
    <section class="card pad rep-method">
      <div class="mini-h">Method and limitations</div>
      <p class="small muted">Continuous-space agents on a 0.5 m grid; per-exit Dijkstra distance fields with a congestion cost; Weidmann speed–density relation; doors limited to 1.33 persons/s per metre; Gaussian-kernel density (R = 0.7 m); bottlenecks = zones ≥ 2.15 p/m² (Fruin LOS F) for ≥ 3 s. Parameters: reaction ${p.reactionMin}–${p.reactionMax} s, ${Math.round(p.slowFraction * 100)} % reduced mobility, ${p.wheelchairs} wheelchair users, panic ${p.panic}. EvacPrint is a comparative planning tool: use it to compare design options, not to certify the venue. Venue dimensions are a planning model and must be verified on site.</p>
    </section>
  </div>`;
  const $ = (s) => root.querySelector(s);
  requestAnimationFrame(() => {
    renderStaticPlan($('[data-plan]'), deserializeLayout(res.layout), { map: res.peakMap, markers: res.bottlenecks.slice(0, 4), dims: true });
    lineChart($('[data-curve]'), [{ name: 'Evacuated', color: 'var(--s-chart-a)', points: res.curve.map((q) => [q.t, q.evacuated]), area: true }], { yMax: res.occupants, height: 170, label: 'People evacuated over time', tipFmt: (v) => `${v} out` });
  });
  let stop = null;
  if (r.compare) stop = renderCompare($('[data-cmp]'), r.compare);
  let isoStop = null;
  const isoHost = $('[data-iso]');
  if (isoHost) {
    Promise.all([import('../render/iso.js'), import('../sim/engine.js')]).then(([{ IsoLive, LoopDriver }, { Simulation }]) => {
      if (!isoHost.isConnected) return;
      const lay = deserializeLayout(res.layout);
      const d = new LoopDriver(() => new Simulation(lay, { ...res.params, occupants: 0 }), { speed: 0 });
      d.paused = true;
      const iso = new IsoLive(isoHost, d, { pad: 8 });
      iso.draw();
      isoStop = () => { iso.destroy(); d.stop(); };
    });
  }
  $('[data-print]').addEventListener('click', () => window.print());
  $('[data-del]').addEventListener('click', () => confirmDelete(id, () => (location.hash = '/reports')));
  void exitsOnly;
  return () => { stop?.(); isoStop?.(); };
}

function venueSection(v, res) {
  const c = v.config || {};
  const d = c.details || {}, p = c.population || {}, a = c.age || {}, m = c.mobility || {}, env = c.environment || {}, b = c.behaviour || {};
  const kv = (rows) => `<dl class="kv">${rows.filter((x) => x[1] !== '' && x[1] != null).map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(String(val))}</dd></div>`).join('')}</dl>`;
  const pct = a.unit === 'count' ? '' : ' %';
  return `
  <section class="card pad rep-venue">
    <div class="mini-h">Venue</div>
    <div class="rv-grid">
      <div>
        <h3 style="font-size:17px;margin-bottom:8px">${esc(v.name)}</h3>
        ${v.scaleVerified ? '<span class="chip teal">dimensions verified on site</span>' : '<span class="chip amber">dimensions not verified — planning estimates</span>'}
        ${kv([['Building type', d.buildingType], ['Category', d.category], ['Floor', d.floor != null ? `${d.floor} of ${d.totalFloors}` : ''], ['Indoor', d.indoor ? 'yes' : 'no'], ['Floor area', v.area ? `${v.area.toFixed(1)} m²` : ''], ['Normal / max occupancy', `${d.normalOcc ?? '—'} / ${d.maxOcc ?? '—'}`], ['Ceiling height', c.dimensions?.ceiling ? `${c.dimensions.ceiling} m` : '']])}
      </div>
      <div class="rv-iso" data-iso aria-label="3D preview of the venue"></div>
    </div>
    <div class="rv-cols">
      <div><div class="mini-h">Population</div>${kv([['Total people', p.total], ['Seated / standing / corridors / entrances (weights)', `${p.seats} / ${p.standing} / ${p.corridors} / ${p.entrances}`], ['Familiar with venue', `${b.familiarPct} %`], ['Staff / security', `${b.staff} / ${b.security}`]])}</div>
      <div><div class="mini-h">Age groups</div>${kv([['Children 0–12', `${a.children}${pct}`], ['Teenagers 13–17', `${a.teens}${pct}`], ['Adults 18–59', `${a.adults}${pct}`], ['Seniors 60+', `${a.seniors}${pct}`]])}</div>
      <div><div class="mini-h">Mobility</div>${kv([['Wheelchair users', m.wheelchair], ['Walking aids', m.walkingAid], ['Temporary injury', m.injured], ['Reduced mobility', m.reduced], ['Visually / hearing impaired', `${m.visual} / ${m.hearing}`], ['Need assistance / caregivers', `${m.assisted} / ${m.caregivers}`]])}</div>
      <div><div class="mini-h">Emergency &amp; environment</div>${kv([['Emergency type', v.emergency?.label || c.emergency?.type], ['Lighting', `${env.lighting}${env.emergencyLighting ? ' (emergency lighting)' : ''}`], ['Visibility', env.visibility], ['Signage', env.signage], ['Alarm', env.alarm], ['Detection + alarm delay', `${env.detectionDelay} + ${env.alarmDelay} s`], ['Pre-movement', `${env.preMin}–${env.preMax} s`]])}</div>
    </div>
    ${v.emergency ? `<p class="small"><b>Simulated:</b> ${esc(v.emergency.sim.join('; ') || '—')}. <b>Not simulated (assumptions):</b> ${esc(v.emergency.notSim.join('; ') || 'none')}.</p>` : ''}
    ${v.exits?.length ? `<div class="mini-h mt">Exit configuration</div><table class="ptable compact"><thead><tr><th>Opening</th><th>Kind</th><th>Width</th><th>Status</th><th>Step-free</th><th>Flow assumption</th></tr></thead><tbody>${v.exits.map((e) => `<tr><td>${esc(e.name)}${e.main ? ' <span class="chip">main</span>' : ''}</td><td>${e.type === 'exit' ? 'final exit' : 'door'}</td><td class="mono">${(+e.width).toFixed(2)} m</td><td>${e.open === false ? 'closed' : 'open'}</td><td>${e.accessible === false ? 'no' : 'yes'}</td><td class="mono">${e.flow || 1.33} p/s/m</td></tr>`).join('')}</tbody></table>` : ''}
    ${v.profiles?.length ? `<div class="mini-h mt">Outcome by population group</div><table class="ptable compact"><thead><tr><th>Group</th><th>People</th><th>Mean exit</th><th>Last out</th></tr></thead><tbody>${v.profiles.map((q) => `<tr><td>${esc(q.label)}</td><td class="mono">${q.n}</td><td class="mono">${fmtSec(q.meanExit)}</td><td class="mono">${fmtSec(q.lastExit)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${v.rsets?.length > 1 ? `<p class="small mt">Across ${v.rsets.length} runs (different seeds) the evacuation time ranged ${Math.min(...v.rsets.filter((x) => x != null)).toFixed(1)}–${Math.max(...v.rsets.filter((x) => x != null)).toFixed(1)} s.</p>` : ''}
    ${(v.risk || res.risk)?.length ? `<div class="mini-h mt">Risk analysis (model estimate)</div><ol class="risk-list compact">${(v.risk || res.risk).map((f, i) => `<li class="risk ${f.severity}"><span class="rk">${i + 1}</span><div><b>${esc(f.title)}</b><p>${esc(f.detail)}</p></div></li>`).join('')}</ol>` : ''}
    ${v.assumptions?.length ? `<div class="mini-h mt">Model assumptions</div><ul class="small muted">${v.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="small muted mt"><b>Validation notes.</b> These results come from a comparative planning model. They are not a fire-safety certificate. Verify dimensions on site and calibrate against a timed drill before using absolute times.</p>
  </section>`;
}
