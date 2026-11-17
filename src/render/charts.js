// Lightweight SVG charts. Thin marks, recessive axes, one y-axis per chart,
// legends for ≥2 series, crosshair tooltip on line charts, per-bar tooltips.
import { showTip, hideTip, esc } from '../ui/dom.js';

const NS = 'http://www.w3.org/2000/svg';

function niceMax(v) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}
function ticks(max, n = 4) {
  const step = niceMax(max / n);
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/**
 * series: [{ name, color, points: [[x,y]...], dash?, area? }]
 * opts: { xLabel, yLabel, yMax, xMax, height, refLines:[{y,label,color}], xFmt, yFmt, unit }
 */
export function lineChart(host, series, opts = {}) {
  const W = host.clientWidth || 320;
  const H = opts.height || 170;
  const m = { l: 34, r: 10, t: 10, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const xMax = niceMax(opts.xMax ?? Math.max(10, ...xs));
  const yMax = opts.yMax ?? niceMax(Math.max(1, ...ys, ...(opts.refLines || []).map((r) => r.y * 1.1)));
  const X = (v) => m.l + (v / xMax) * iw;
  const Y = (v) => m.t + ih - (Math.min(v, yMax) / yMax) * ih;
  const xFmt = opts.xFmt || ((v) => `${v}s`);
  const yFmt = opts.yFmt || ((v) => `${v}`);

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.label || 'Line chart')}">`;
  for (const t of ticks(yMax)) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" class="gl"/>`;
    svg += `<text x="${m.l - 6}" y="${Y(t) + 3.5}" class="tk" text-anchor="end">${yFmt(t)}</text>`;
  }
  for (const t of ticks(xMax, 5)) svg += `<text x="${X(t)}" y="${H - 7}" class="tk" text-anchor="middle">${xFmt(t)}</text>`;
  for (const r of opts.refLines || []) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}" class="ref" stroke="${r.color || 'currentColor'}"/>`;
    svg += `<text x="${W - m.r - 2}" y="${Y(r.y) - 4}" class="tk ref-t" text-anchor="end" fill="${r.color}">${esc(r.label)}</text>`;
  }
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    if (s.area) svg += `<path d="${d}L${X(s.points.at(-1)[0])},${Y(0)}L${X(s.points[0][0])},${Y(0)}Z" fill="${s.color}" opacity="0.1"/>`;
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="4 4"' : ''}/>`;
    const last = s.points.at(-1);
    if (s.endDot !== false) svg += `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="3.5" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`;
  }
  svg += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  svg += `<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" class="hit"/>`;
  svg += `</svg>`;
  host.innerHTML = svg;
  if (series.length > 1 && opts.legend !== false) {
    host.insertAdjacentHTML('beforeend', `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}${s.dash ? ';opacity:.7' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>`);
  }
  const el = host.querySelector('svg');
  const xh = el.querySelector('.xh');
  const hit = el.querySelector('.hit');
  hit.addEventListener('pointermove', (ev) => {
    const r = el.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const xv = ((px - m.l) / iw) * xMax;
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
    const rows = series.map((s) => {
      let best = null, bd = Infinity;
      for (const p of s.points) { const d = Math.abs(p[0] - xv); if (d < bd) { bd = d; best = p; } }
      return best ? `<div class="t-row"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><span>${(opts.tipFmt || yFmt)(best[1])}</span></div>` : '';
    }).join('');
    showTip(`<div class="t-h">${opts.xName || 't'} = ${xFmt(Math.max(0, Math.round(xv)))}</div>${rows}`, ev.clientX, ev.clientY);
  });
  hit.addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
}

/**
 * Horizontal bars. rows: [{ label, value, max?, color, note, tip, muted }]
 */
export function hBars(host, rows, opts = {}) {
  const max = opts.max ?? Math.max(1, ...rows.map((r) => r.value));
  host.innerHTML = `<div class="hbars">${rows
    .map(
      (r, i) => `<div class="hb-row ${r.muted ? 'muted-row' : ''}" data-i="${i}">
      <div class="hb-l"><span>${esc(r.label)}</span>${r.sub ? `<em>${esc(r.sub)}</em>` : ''}</div>
      <div class="hb-track"><i style="width:${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%;background:${r.color || 'var(--s-chart-a)'}"></i>${r.ghost != null ? `<b style="left:${(r.ghost / max) * 100}%"></b>` : ''}</div>
      <div class="hb-v">${esc(r.note ?? r.value)}</div>
    </div>`,
    )
    .join('')}</div>`;
  host.querySelectorAll('.hb-row').forEach((row) => {
    const r = rows[+row.dataset.i];
    if (!r.tip) return;
    row.addEventListener('pointermove', (ev) => showTip(r.tip, ev.clientX, ev.clientY));
    row.addEventListener('pointerleave', hideTip);
  });
}

/** Stacked 100 % bar comparing shares (exit utilisation before vs after). */
export function shareBar(groups, colorFor) {
  const total = groups.reduce((s, g) => s + g.count, 0) || 1;
  return `<div class="sharebar">${groups
    .filter((g) => g.count > 0)
    .map((g) => `<i style="flex:${g.count / total};background:${colorFor(g)}" title="${esc(g.name)}: ${g.count} (${Math.round((g.count / total) * 100)}%)"></i>`)
    .join('')}</div>`;
}

export { NS };
