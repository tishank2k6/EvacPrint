// Before / after redesign comparison. Every number comes from two full
// simulation runs with identical occupants (same seed) — original layout vs
// the layout with the recommended change applied.
import { deserializeLayout } from '../sim/layout.js';
import { renderStaticPlan } from '../render/floorplan.js';
import { lineChart } from '../render/charts.js';
import { icon } from './icons.js';
import { esc, fmtSec, showTip, hideTip } from './dom.js';
import { BAND, BAND_LABEL, BAND_RANGE } from '../render/colors.js';

const delta = (a, b, unit, d = 1, better = 'lower') => {
  if (a == null || b == null) return '';
  const v = b - a;
  const good = better === 'lower' ? v < 0 : v > 0;
  const cls = Math.abs(v) < 10 ** -d ? 'flat' : good ? 'good' : 'bad';
  return `<span class="delta ${cls}">${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}${unit}</span>`;
};

export function densityLegend(title = 'Crowd density') {
  return `<div class="dlegend"><span class="dl-t">${title}</span>${BAND.map((c, i) => `<span class="dl-i"><i style="background:${c}"></i>${BAND_LABEL[i]}<em>${BAND_RANGE[i]}</em></span>`).join('')}</div>`;
}

export function renderCompare(host, cmp) {
  const A = cmp.before.result, B = cmp.after.result;
  const exposureSum = (r) => (r.exposure || []).reduce((s, v) => s + v, 0);
  host.innerHTML = `
  <div class="cmp">
    <div class="cmp-head">
      <div>
        <span class="eyebrow">Recommended change</span>
        <h3>${esc(cmp.title)}</h3>
        <p class="faint">Both runs: ${A.occupants} occupants, identical seat assignment and reaction times (seed ${A.params.seed}).${cmp.savedMin != null ? ` Across 3 seeds the change saves ${cmp.savedMin.toFixed(1)}–${cmp.savedMax.toFixed(1)} s.` : ''}</p>
      </div>
      <div class="seg" role="group" aria-label="Comparison view">
        <button aria-pressed="true" data-v="side">${icon('compare')}Side by side</button>
        <button aria-pressed="false" data-v="swipe">${icon('split')}Swipe</button>
      </div>
    </div>
    <div class="cmp-kpis">
      <div class="ck"><span>Evacuation time (RSET)</span><b>${fmtSec(A.rset)} <i>→</i> ${fmtSec(B.rset)}</b>${delta(A.rset, B.rset, ' s')}</div>
      <div class="ck"><span>95 % evacuated</span><b>${fmtSec(A.t95)} <i>→</i> ${fmtSec(B.t95)}</b>${delta(A.t95, B.t95, ' s')}</div>
      <div class="ck"><span>Peak density</span><b>${A.peakDensity.value.toFixed(2)} <i>→</i> ${B.peakDensity.value.toFixed(2)} p/m²</b>${delta(A.peakDensity.value, B.peakDensity.value, '', 2)}</div>
      <div class="ck"><span>Mean time queuing</span><b>${fmtSec(A.meanQueue)} <i>→</i> ${fmtSec(B.meanQueue)}</b>${delta(A.meanQueue, B.meanQueue, ' s')}</div>
      <div class="ck"><span>Floor area-time at LOS F</span><b>${(exposureSum(A) * 0.25).toFixed(0)} <i>→</i> ${(exposureSum(B) * 0.25).toFixed(0)} m²·s</b>${delta(exposureSum(A) * 0.25, exposureSum(B) * 0.25, '', 0)}</div>
    </div>
    <div class="cmp-plans side">
      <figure><figcaption><span class="chip">Original</span><span class="faint">${esc(A.bottlenecks[0]?.label || 'No sustained bottleneck')}</span></figcaption><div class="cmp-canvas"><canvas data-a></canvas></div></figure>
      <figure><figcaption><span class="chip teal">Improved</span><span class="faint">${esc(B.bottlenecks[0]?.label || 'No sustained bottleneck')}</span></figcaption><div class="cmp-canvas"><canvas data-b></canvas></div></figure>
      <div class="cmp-swipe" hidden>
        <div class="cmp-canvas"><canvas data-sa></canvas><div class="sw-top"><canvas data-sb></canvas></div><div class="sw-handle" role="slider" tabindex="0" aria-label="Swipe between original and improved" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><span>${icon('compare')}</span></div>
        <span class="sw-lab l">Original</span><span class="sw-lab r">Improved</span></div>
      </div>
    </div>
    ${densityLegend('Peak density reached')}
    <div class="cmp-charts">
      <div class="card pad"><div class="mini-h">Evacuation curve</div><div class="cmp-curve"></div></div>
      <div class="card pad"><div class="mini-h">Exit utilisation (persons through each opening)</div><div class="cmp-exits"></div></div>
    </div>
  </div>`;

  const la = deserializeLayout(cmp.before.layout), lb = deserializeLayout(cmp.after.layout);
  const draw = () => {
    const side = !host.querySelector('.cmp-plans').classList.contains('swipe');
    if (side) {
      renderStaticPlan(host.querySelector('[data-a]'), la, { map: A.peakMap, markers: A.bottlenecks.slice(0, 3) });
      renderStaticPlan(host.querySelector('[data-b]'), lb, { map: B.peakMap, markers: B.bottlenecks.slice(0, 3) });
    } else {
      const sa = host.querySelector('[data-sa]'), sb = host.querySelector('[data-sb]');
      sb.style.width = `${sa.clientWidth}px`;
      sb.style.height = `${sa.clientHeight}px`;
      renderStaticPlan(sa, la, { map: A.peakMap, markers: A.bottlenecks.slice(0, 3) });
      renderStaticPlan(sb, lb, { map: B.peakMap, markers: B.bottlenecks.slice(0, 3) });
    }
  };
  requestAnimationFrame(draw);

  host.querySelectorAll('.seg [data-v]').forEach((b) =>
    b.addEventListener('click', () => {
      host.querySelectorAll('.seg [data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const plans = host.querySelector('.cmp-plans');
      const sw = b.dataset.v === 'swipe';
      plans.classList.toggle('swipe', sw);
      plans.classList.toggle('side', !sw);
      host.querySelector('.cmp-swipe').hidden = !sw;
      plans.querySelectorAll('figure').forEach((f) => (f.hidden = sw));
      requestAnimationFrame(draw);
    }),
  );
  // swipe handle
  const swipe = host.querySelector('.cmp-swipe .cmp-canvas');
  const top = host.querySelector('.sw-top');
  const handle = host.querySelector('.sw-handle');
  const setPos = (p) => {
    p = Math.max(0, Math.min(100, p));
    top.style.clipPath = `inset(0 0 0 ${p}%)`;
    handle.style.left = `${p}%`;
    handle.setAttribute('aria-valuenow', Math.round(p));
  };
  setPos(50);
  let drag = false;
  const move = (ev) => { if (!drag) return; const r = swipe.getBoundingClientRect(); setPos(((ev.clientX - r.left) / r.width) * 100); };
  handle.addEventListener('pointerdown', (e) => { drag = true; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', () => (drag = false));
  swipe.addEventListener('click', (ev) => { if (ev.target.closest('.sw-handle')) return; const r = swipe.getBoundingClientRect(); setPos(((ev.clientX - r.left) / r.width) * 100); });
  handle.addEventListener('keydown', (e) => {
    const cur = parseFloat(handle.style.left) || 50;
    if (e.key === 'ArrowLeft') setPos(cur - 5);
    if (e.key === 'ArrowRight') setPos(cur + 5);
  });

  // curves
  const pts = (r) => (r.curve || []).map((p) => [p.t, p.evacuated]);
  lineChart(host.querySelector('.cmp-curve'), [
    { name: 'Original', color: 'var(--s-chart-base)', points: pts(A), dash: true },
    { name: 'Improved', color: 'var(--s-chart-a)', points: pts(B) },
  ], { yMax: A.occupants, height: 180, label: 'Evacuated people over time, original versus improved', tipFmt: (v) => `${v} out` });

  // exits: grouped bars
  const names = [...new Set([...A.groups, ...B.groups].map((g) => g.name))];
  const max = Math.max(1, ...A.groups.map((g) => g.count), ...B.groups.map((g) => g.count));
  const ex = host.querySelector('.cmp-exits');
  ex.innerHTML = `<div class="gbars">${names
    .map((n) => {
      const a = A.groups.find((g) => g.name === n), b = B.groups.find((g) => g.name === n);
      const bar = (g, cls) => `<div class="gb ${cls}"><i style="width:${g ? (g.count / max) * 100 : 0}%"></i><span>${g ? (g.blocked ? 'blocked' : g.count) : '—'}</span></div>`;
      return `<div class="gb-row" data-n="${esc(n)}"><div class="gb-l">${esc(n)}<em>${b ? b.widthM.toFixed(1) + ' m' : ''}${a && b && a.widthM !== b.widthM ? ` (was ${a.widthM.toFixed(1)})` : ''}${!a ? ' (new)' : ''}</em></div><div>${bar(a, 'a')}${bar(b, 'b')}</div></div>`;
    })
    .join('')}</div><div class="legend"><span><i style="background:var(--s-chart-base)"></i>Original</span><span><i style="background:var(--s-chart-a)"></i>Improved</span></div>`;
  ex.querySelectorAll('.gb-row').forEach((row) => {
    const n = row.dataset.n;
    const a = A.groups.find((g) => g.name === n), b = B.groups.find((g) => g.name === n);
    row.addEventListener('pointermove', (ev) => showTip(`<div class="t-h">${esc(n)}</div>
      <div class="t-row"><span>Original</span><span>${a ? `${a.count} · peak ${a.peakFlow} p/s` : '—'}</span></div>
      <div class="t-row"><span>Improved</span><span>${b ? `${b.count} · peak ${b.peakFlow} p/s` : '—'}</span></div>
      <div class="t-row"><span>Capacity</span><span>${b ? b.capacity : a.capacity} p/s</span></div>`, ev.clientX, ev.clientY));
    row.addEventListener('pointerleave', hideTip);
  });

  const ro = new ResizeObserver(() => draw());
  ro.observe(host.querySelector('.cmp-plans'));
  return () => ro.disconnect();
}
