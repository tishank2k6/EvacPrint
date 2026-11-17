// Renders EvacPrint's standalone illustrations as SVG files in ./illustrations.
// Every data-bearing figure is produced by running the real simulation engine
// (seed 406), so the drawings can go straight into a pitch deck or report.
//   npm run illustrations
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHall406, cloneLayout, compile, generateCandidates, CELL, T } from '../src/sim/layout.js';
import { Simulation, STATE } from '../src/sim/engine.js';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { densityRGBA, BAND, BAND_LABEL, BAND_RANGE } from '../src/render/colors.js';
import { dijkstra, abm, bottleneckId } from '../src/ui/illustrations.js';
import { distanceField } from '../src/sim/pathfinding.js';

const OUT = new URL('../illustrations/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const C = { bg: '#0f1113', panel: '#131619', floor: '#191c20', wall: '#d4cdc0', seat: '#3d444c', stage: '#22272c', ink: '#ece6da', ink2: '#b4ada1', ink3: '#847e74', teal: '#2fb8a6', amber: '#e3a03a', red: '#e0524a' };
const MONO = "IBM Plex Mono, ui-monospace, monospace";
const SANS = "IBM Plex Sans, system-ui, sans-serif";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rgba = (rho) => { const o = [0, 0, 0, 0]; densityRGBA(rho, o, 0); return o[3] < 4 ? null : `rgba(${o[0]},${o[1]},${o[2]},${(o[3] / 255).toFixed(2)})`; };
const logo = (x, y) => `<g transform="translate(${x} ${y})"><rect width="26" height="26" rx="6" fill="#1b2025" stroke="rgba(236,230,218,.16)"/><path d="M6.5 6.5h10.5v3.7M6.5 6.5v13h10.5v-3.7" fill="none" stroke="${C.ink}" stroke-width="1.7"/><path d="M10.2 13h10.5" stroke="${C.teal}" stroke-width="1.8" stroke-linecap="round"/><path d="m17.5 9.8 3.2 3.2-3.2 3.2" fill="none" stroke="${C.teal}" stroke-width="1.8" stroke-linecap="round"/><text x="36" y="18" fill="${C.ink}" font-family="${SANS}" font-size="15" font-weight="600">EvacPrint</text></g>`;

function frame(W, H, title, caption, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${C.bg}"/>
<g opacity=".5" stroke="rgba(236,230,218,.05)">${Array.from({ length: Math.ceil(W / 32) }, (_, i) => `<line x1="${i * 32}" y1="0" x2="${i * 32}" y2="${H}"/>`).join('')}${Array.from({ length: Math.ceil(H / 32) }, (_, i) => `<line x1="0" y1="${i * 32}" x2="${W}" y2="${i * 32}"/>`).join('')}</g>
${logo(32, 26)}
<text x="${W - 32}" y="44" text-anchor="end" fill="${C.ink3}" font-family="${MONO}" font-size="11" letter-spacing="1.2">${esc(title.toUpperCase())}</text>
${body}
<text x="32" y="${H - 28}" fill="${C.ink2}" font-family="${SANS}" font-size="13">${esc(caption)}</text>
</svg>`;
}

/** 2D plan as SVG: floor, seats, stage, density, walls, openings, agents */
function planSVG(layout, { x, y, w, h, map = null, agents = null, markers = [], labels = true, arrows = null, sim = null }) {
  const c = compile(layout);
  const s = Math.min(w / (c.w * CELL), h / (c.h * CELL));
  const ox = x + (w - c.w * CELL * s) / 2, oy = y + (h - c.h * CELL * s) / 2;
  const cs = CELL * s;
  let out = '';
  for (let yy = 0; yy < c.h; yy++) {
    let xx = 0;
    while (xx < c.w) {
      const t = c.cells[yy * c.w + xx];
      if (t === T.VOID) { xx++; continue; }
      let x1 = xx;
      while (x1 + 1 < c.w && c.cells[yy * c.w + x1 + 1] !== T.VOID) x1++;
      out += `<rect x="${(ox + xx * cs).toFixed(1)}" y="${(oy + yy * cs).toFixed(1)}" width="${((x1 - xx + 1) * cs + 0.4).toFixed(1)}" height="${(cs + 0.4).toFixed(1)}" fill="${C.floor}"/>`;
      xx = x1 + 1;
    }
  }
  for (let i = 0; i < c.n; i++) {
    const t = c.cells[i], xx = i % c.w, yy = (i / c.w) | 0, px = ox + xx * cs, py = oy + yy * cs;
    if (t === T.STAGE) out += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(cs + 0.4).toFixed(1)}" height="${(cs + 0.4).toFixed(1)}" fill="${C.stage}"/>`;
    if (t === T.SEAT) out += `<rect x="${(px + cs * 0.12).toFixed(1)}" y="${(py + cs * 0.12).toFixed(1)}" width="${(cs * 0.76).toFixed(1)}" height="${(cs * 0.66).toFixed(1)}" rx="${(cs * 0.12).toFixed(1)}" fill="${C.seat}"/>`;
    if (t === T.OBST) out += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${cs.toFixed(1)}" height="${cs.toFixed(1)}" fill="#3a3326" stroke="rgba(227,160,58,.5)"/>`;
  }
  if (map) for (let i = 0; i < c.n; i++) { if (!c.passable[i]) continue; const col = rgba(map[i]); if (col) out += `<rect x="${(ox + (i % c.w) * cs).toFixed(1)}" y="${(oy + ((i / c.w) | 0) * cs).toFixed(1)}" width="${(cs + 0.3).toFixed(1)}" height="${(cs + 0.3).toFixed(1)}" fill="${col}"/>`; }
  if (arrows) out += arrows(ox, oy, cs, c);
  for (let yy = 0; yy < c.h; yy++) { let xx = 0; while (xx < c.w) { if (c.cells[yy * c.w + xx] !== T.WALL) { xx++; continue; } let x1 = xx; while (x1 + 1 < c.w && c.cells[yy * c.w + x1 + 1] === T.WALL) x1++; out += `<rect x="${(ox + xx * cs - 0.3).toFixed(1)}" y="${(oy + yy * cs - 0.3).toFixed(1)}" width="${((x1 - xx + 1) * cs + 0.6).toFixed(1)}" height="${(cs + 0.6).toFixed(1)}" fill="${C.wall}"/>`; xx = x1 + 1; } }
  for (const g of c.groups) {
    const { minX, maxX, minY, maxY } = g.bounds;
    const col = g.blocked ? C.red : g.type === 'exit' ? C.teal : '#6f6a62';
    out += `<rect x="${(ox + minX * cs).toFixed(1)}" y="${(oy + minY * cs).toFixed(1)}" width="${((maxX - minX + 1) * cs).toFixed(1)}" height="${((maxY - minY + 1) * cs).toFixed(1)}" fill="${col}" opacity="${g.type === 'exit' || g.blocked ? 0.9 : 0.55}"/>`;
    if (g.blocked) out += `<path d="M${ox + minX * cs} ${oy + minY * cs}l${(maxX - minX + 1) * cs} ${(maxY - minY + 1) * cs}M${ox + (maxX + 1) * cs} ${oy + minY * cs}l${-(maxX - minX + 1) * cs} ${(maxY - minY + 1) * cs}" stroke="#fff" stroke-width="1.5"/>`;
    if (labels) {
      const lx = ox + g.cx * s, ly = oy + g.cy * s;
      const dx = g.horizontal ? 0 : (g.bounds.minX < c.w / 2 ? -1 : 1), dy = g.horizontal ? (g.bounds.minY < c.h / 2 ? -1 : 1) : 0;
      const cnt = sim ? ` · ${sim.gatePasses[g.id].length}` : '';
      let tx = lx + dx * cs * 2.6; const tw = (g.name.length + 12) * 6.1; if (dx < 0 && tx - tw < 6) tx = tw + 6; out += `<text x="${tx.toFixed(1)}" y="${(ly + dy * cs * 2.2 + 3).toFixed(1)}" text-anchor="${dx < 0 ? 'end' : dx > 0 ? 'start' : 'middle'}" fill="${g.blocked ? C.red : g.type === 'exit' ? C.teal : C.ink2}" font-family="${MONO}" font-size="10">${esc(g.name + (g.blocked ? ' · blocked' : cnt))}</text>`;
    }
  }
  if (agents) for (const a of agents) out += a.wait ? `<circle cx="${(ox + a.x * s).toFixed(1)}" cy="${(oy + a.y * s).toFixed(1)}" r="${(a.r * s * 0.8).toFixed(1)}" fill="none" stroke="rgba(236,230,218,.45)" stroke-width="1"/>` : `<circle cx="${(ox + a.x * s).toFixed(1)}" cy="${(oy + a.y * s).toFixed(1)}" r="${(a.r * s * 0.92).toFixed(1)}" fill="${a.col}"/>`;
  markers.forEach((b, k) => {
    const r = Math.max(0.9, Math.sqrt(b.areaM2 / Math.PI) + 0.5) * s, mx = ox + b.x * s, my = oy + b.y * s;
    out += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#ff7b72" stroke-width="1.5" stroke-dasharray="4 3"/><rect x="${(mx + r * 0.7 - 2).toFixed(1)}" y="${(my - r * 0.7 - 9).toFixed(1)}" width="26" height="18" rx="9" fill="#c93a3a"/><text x="${(mx + r * 0.7 + 11).toFixed(1)}" y="${(my - r * 0.7 + 4).toFixed(1)}" text-anchor="middle" fill="#fff" font-family="${MONO}" font-size="10.5" font-weight="600">B${k + 1}</text>`;
  });
  return { svg: out, s, ox, oy, c };
}

function legend(x, y, title) {
  let o = `<text x="${x}" y="${y}" fill="${C.ink3}" font-family="${MONO}" font-size="10" letter-spacing="1">${title}</text>`;
  BAND.forEach((col, i) => { const xx = x + 150 + i * 150; o += `<rect x="${xx}" y="${y - 9}" width="16" height="10" rx="2" fill="${col}"/><text x="${xx + 22}" y="${y}" fill="${C.ink2}" font-family="${SANS}" font-size="12">${BAND_LABEL[i]} <tspan fill="${C.ink3}" font-family="${MONO}" font-size="10">${esc(BAND_RANGE[i])}</tspan></text>`; });
  return o;
}

const run = (layout, params) => { const s = new Simulation(layout, params); s.runToEnd(); return s; };
const agentsOf = (sim) => {
  const out = [];
  for (let i = 0; i < sim.N; i++) {
    if (sim.state[i] === STATE.EVACUATED) continue;
    const col = sim.congested[i] ? '#f06d64' : sim.cat[i] === 1 ? C.amber : sim.cat[i] === 2 ? '#8b9be0' : C.ink;
    out.push({ x: sim.x[i], y: sim.y[i], r: sim.r[i], col, wait: sim.state[i] === STATE.WAITING });
  }
  return out;
};

// ------------------------------------------------------------------ 01 3D auditorium (isometric cutaway)
{
  const L = createHall406();
  const sim = new Simulation(L, { occupants: 220, reactionMin: 0, reactionMax: 10, seed: 406 });
  for (let i = 0; i < 220; i++) sim.step();
  const c = sim.c;
  const W = 1600, H = 1000;
  const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  const Wm = c.w * CELL, Hm = c.h * CELL;
  const k = Math.min((W - 160) / ((Wm + Hm) * C30), (H - 220) / ((Wm + Hm) * S30 + 2.4));
  const ox = W / 2 - ((Wm - Hm) * C30 * k) / 2, oy = 120 + 2.4 * k * 0.4;
  const P = (X, Z, Y = 0) => [ox + (X - Z) * C30 * k, oy + (X + Z) * S30 * k - Y * k];
  const poly = (pts, fill, stroke = 'rgba(15,17,19,.45)') => `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width=".6"/>`;
  const prism = (x0, z0, x1, z1, hgt, top, left, right, seamless = false) => poly([P(x0, z1), P(x1, z1), P(x1, z1, hgt), P(x0, z1, hgt)], left, seamless ? left : undefined) + poly([P(x1, z1), P(x1, z0), P(x1, z0, hgt), P(x1, z1, hgt)], right, seamless ? right : undefined) + poly([P(x0, z1, hgt), P(x1, z1, hgt), P(x1, z0, hgt), P(x0, z0, hgt)], top, seamless ? top : undefined);
  let body = '';
  // floor
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const t = c.cells[y * c.w + x]; if (t !== T.VOID && t !== T.WALL) body += poly([P(x * CELL, y * CELL), P((x + 1) * CELL, y * CELL), P((x + 1) * CELL, (y + 1) * CELL), P(x * CELL, (y + 1) * CELL)], (x + y) % 2 ? '#1a1d21' : '#1c1f23', 'none'); }
  // density under the crowd
  for (let i = 0; i < c.n; i++) { if (!c.passable[i]) continue; const col = rgba(sim.densityEMA[i]); if (!col) continue; const x = i % c.w, y = (i / c.w) | 0; body += poly([P(x * CELL, y * CELL), P((x + 1) * CELL, y * CELL), P((x + 1) * CELL, (y + 1) * CELL), P(x * CELL, (y + 1) * CELL)], col, 'none'); }
  // objects in painter's order: walls, stage, seats, agents
  const items = [];
  for (let i = 0; i < c.n; i++) {
    const t = c.cells[i], x = i % c.w, y = (i / c.w) | 0;
    const x0 = x * CELL, z0 = y * CELL;
    if (t === T.WALL) items.push([x0 + z0 + 1, prism(x0, z0, x0 + CELL, z0 + CELL, 1.4, '#e6dfd2', '#8f8a81', '#b2ab9f', true)]);
    else if (t === T.STAGE) items.push([x0 + z0, prism(x0, z0, x0 + CELL, z0 + CELL, 0.6, '#3a4047', '#23282d', '#2c3237', true)]);
    else if (t === T.SEAT) items.push([x0 + z0 + 0.5, prism(x0 + 0.06, z0 + 0.06, x0 + 0.44, z0 + 0.42, 0.45, '#525a64', '#30363d', '#3c434b') + prism(x0 + 0.06, z0 + 0.38, x0 + 0.44, z0 + 0.46, 0.85, '#5c656f', '#353b42', '#424a52')]);
    else if (t === T.OBST) items.push([x0 + z0 + 0.5, prism(x0, z0, x0 + CELL, z0 + CELL, 0.9, '#6b5a3c', '#3d3424', '#54472f')]);
    else if (t === T.EXIT || t === T.DOOR) { const g = c.groups[c.groupOf[i]]; if (g.type === 'exit') items.push([x0 + z0 + 1.2, prism(x0, z0, x0 + CELL, z0 + CELL, 0.06, C.teal, '#1c7a6d', '#24978a', true)]); }
  }
  for (let i = 0; i < sim.N; i++) {
    if (sim.state[i] === STATE.EVACUATED) continue;
    const [sx, sy] = P(sim.x[i], sim.y[i]);
    const seated = sim.state[i] === STATE.WAITING && sim.seated[i];
    const col = sim.state[i] === STATE.WAITING ? '#8a857c' : sim.congested[i] ? '#f06d64' : sim.cat[i] === 1 ? C.amber : C.ink;
    const hh = (seated ? 0.95 : 1.5) * k;
    items.push([sim.x[i] + sim.y[i] + 0.3, `<ellipse cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" rx="${(0.22 * k).toFixed(1)}" ry="${(0.11 * k).toFixed(1)}" fill="rgba(0,0,0,.4)"/><line x1="${sx.toFixed(1)}" y1="${(sy - 0.1 * k).toFixed(1)}" x2="${sx.toFixed(1)}" y2="${(sy - hh + 0.32 * k).toFixed(1)}" stroke="${col}" stroke-width="${(0.3 * k).toFixed(1)}" stroke-linecap="round"/><circle cx="${sx.toFixed(1)}" cy="${(sy - hh + 0.1 * k).toFixed(1)}" r="${(0.14 * k).toFixed(1)}" fill="${col}"/>`]);
  }
  items.sort((a, b) => a[0] - b[0]);
  body += items.map((i) => i[1]).join('');
  for (const g of c.groups) { const [lx, ly] = P(g.cx, g.cy, 2.6); if (g.type === 'exit') { const [ax, ay] = P(g.cx, g.cy, 1.55); body += `<rect x="${(ax - 0.55 * k).toFixed(1)}" y="${(ay - 0.17 * k).toFixed(1)}" width="${(1.1 * k).toFixed(1)}" height="${(0.34 * k).toFixed(1)}" rx="3" fill="#1fa58f"/><text x="${ax.toFixed(1)}" y="${(ay + 4).toFixed(1)}" text-anchor="middle" fill="#eafffb" font-family="${MONO}" font-size="11" font-weight="600">EXIT</text>`; } body += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="${g.type === 'exit' ? C.teal : C.ink2}" font-family="${MONO}" font-size="12">${esc(g.name)}</text>`; }
  writeFileSync(new URL('01-auditorium-3d.svg', OUT), frame(W, H, '01 · 3D auditorium cutaway', `Seminar Hall 406 extruded from the 0.5 m grid: 340 seats, stage, aisles, three hall doors and three exits. 220 live agents at t = ${sim.t.toFixed(0)} s (seed 406).`, body));
}

// ------------------------------------------------------------------ 02 crowd evacuation
{
  const L = cloneLayout(createHall406()); L.blocked = ['Door B'];
  const sim = new Simulation(L, { ...SCENARIOS[1].params, reactionMin: 4, reactionMax: 16, seed: 406 });
  for (let i = 0; i < 360; i++) sim.step();
  const arrows = (ox, oy, cs, c) => {
    let o = '';
    for (let y = 1; y < c.h - 1; y += 2) for (let x = 1; x < c.w - 1; x += 2) {
      const i = y * c.w + x; if (!c.passable[i] || !isFinite(sim.combined[i])) continue;
      let bx = 0, by = 0, best = sim.combined[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (y + dy) * c.w + x + dx; if ((dx || dy) && c.passable[j] && sim.combined[j] < best) { best = sim.combined[j]; bx = dx; by = dy; } }
      if (!bx && !by) continue;
      const m = Math.hypot(bx, by), ux = bx / m, uy = by / m, cx = ox + (x + 0.5) * cs, cy = oy + (y + 0.5) * cs, a = cs * 0.5;
      o += `<path d="M${(cx - ux * a - uy * a * 0.55).toFixed(1)} ${(cy - uy * a + ux * a * 0.55).toFixed(1)}L${(cx + ux * a * 0.6).toFixed(1)} ${(cy + uy * a * 0.6).toFixed(1)}L${(cx - ux * a + uy * a * 0.55).toFixed(1)} ${(cy - uy * a - ux * a * 0.55).toFixed(1)}" fill="none" stroke="rgba(47,184,166,.45)" stroke-width="1.1"/>`;
    }
    return o;
  };
  const p = planSVG(L, { x: 40, y: 80, w: 1200, h: 800, map: sim.densityEMA, agents: agentsOf(sim), markers: sim.liveBottlenecks.slice(0, 3), arrows, sim });
  let side = `<g font-family="${SANS}"><text x="1290" y="130" fill="${C.ink}" font-size="22" font-weight="600">Door B blocked</text>
  <text x="1290" y="162" fill="${C.ink3}" font-family="${MONO}" font-size="12">t = ${sim.t.toFixed(1)} s · ${sim.evacuated}/${sim.N} evacuated</text>`;
  const rows = [[C.ink, 'Walking'], ['#f06d64', 'Queuing / congested'], [C.amber, 'Reduced mobility'], ['rgba(236,230,218,.45)', 'Still reacting']];
  rows.forEach(([col, t], i) => { side += `<circle cx="1298" cy="${206 + i * 28}" r="6" fill="${i === 3 ? 'none' : col}" stroke="${col}"/><text x="1314" y="${211 + i * 28}" fill="${C.ink2}" font-size="13">${t}</text>`; });
  side += `<path d="M1292 330l10 6-10 6" fill="none" stroke="rgba(47,184,166,.8)" stroke-width="1.5"/><text x="1314" y="341" fill="${C.ink2}" font-size="13">Route field to nearest exit</text>`;
  sim.liveBottlenecks.slice(0, 3).forEach((b, i) => { side += `<text x="1290" y="${400 + i * 22}" fill="${C.ink2}" font-size="13"><tspan fill="#ff7b72" font-family="${MONO}">B${i + 1}</tspan>  ${esc(b.label)} · ${b.peak.toFixed(1)} p/m²</text>`; });
  side += '</g>';
  writeFileSync(new URL('02-crowd-evacuation.svg', OUT), frame(1600, 1000, '02 · Live crowd evacuation', 'Real engine state: 200 occupants rerouting around blocked Door B. Agents, routes, queues and bottlenecks are read from the simulation at this instant.', p.svg + side + legend(40, 928, 'DENSITY')));
}

// ------------------------------------------------------------------ 03 density heatmap
let normalRun;
{
  const sc = SCENARIOS[2];
  const sim = run(cloneLayout(createHall406()), { ...sc.params, seed: 406 });
  const r = sim.summary();
  const p = planSVG(createHall406(), { x: 40, y: 80, w: 1200, h: 800, map: sim.peakMap, markers: r.bottlenecks.slice(0, 4) });
  let side = `<g font-family="${SANS}"><text x="1290" y="130" fill="${C.ink}" font-size="22" font-weight="600">Larger crowd · 400 people</text>
  <text x="1290" y="162" fill="${C.ink3}" font-family="${MONO}" font-size="12">RSET ${r.rset} s · peak ${r.peakDensity.value} p/m² (LOS ${r.peakDensity.los})</text>`;
  r.bottlenecks.slice(0, 4).forEach((b, i) => { side += `<text x="1290" y="${210 + i * 46}" fill="${C.ink}" font-size="14"><tspan fill="#ff7b72" font-family="${MONO}">B${i + 1}</tspan>  ${esc(b.label)}</text><text x="1318" y="${230 + i * 46}" fill="${C.ink3}" font-family="${MONO}" font-size="11">${b.areaM2.toFixed(1)} m² · peak ${b.peak.toFixed(2)} p/m² · ${b.exposure.toFixed(0)} cell·s</text>`; });
  side += `<text x="1290" y="430" fill="${C.ink3}" font-size="12">Colour = highest density each spot reached</text><text x="1290" y="448" fill="${C.ink3}" font-size="12">during the run (Gaussian kernel, R = 0.7 m).</text></g>`;
  writeFileSync(new URL('03-density-heatmap.svg', OUT), frame(1600, 1000, '03 · Crowd density heatmap', 'Peak density per location from a full 400-occupant run (seed 406). Bands follow Fruin’s pedestrian levels of service.', p.svg + side + legend(40, 928, 'PEAK DENSITY')));
}

// ------------------------------------------------------------------ 04 before / after
{
  const base = cloneLayout(createHall406()); base.blocked = ['Door B'];
  const params = { ...SCENARIOS[1].params, seed: 406 };
  const cand = generateCandidates(base).find((c) => c.id === 'opt:west-exit');
  const a = run(base, params), b = run(cand.layout, params);
  const ra = a.summary(), rb = b.summary();
  const pa = planSVG(base, { x: 40, y: 150, w: 740, h: 560, map: a.peakMap, markers: ra.bottlenecks.slice(0, 3) });
  const pb = planSVG(cand.layout, { x: 820, y: 150, w: 740, h: 560, map: b.peakMap, markers: rb.bottlenecks.slice(0, 3) });
  const head = `<text x="40" y="128" fill="${C.red}" font-family="${MONO}" font-size="13" letter-spacing="1">BEFORE · DOOR B BLOCKED</text><text x="820" y="128" fill="${C.teal}" font-family="${MONO}" font-size="13" letter-spacing="1">AFTER · ${esc(cand.title.toUpperCase())}</text>`;
  const kp = (x, lbl, va, vb, unit, d = 1) => `<g font-family="${SANS}"><text x="${x}" y="770" fill="${C.ink3}" font-size="12">${lbl}</text><text x="${x}" y="800" fill="${C.ink}" font-family="${MONO}" font-size="20">${va.toFixed(d)} → ${vb.toFixed(d)}${unit}</text><text x="${x}" y="826" fill="${vb < va ? C.teal : C.red}" font-family="${MONO}" font-size="14">${vb < va ? '−' : '+'}${Math.abs(vb - va).toFixed(d)}${unit}</text></g>`;
  const exitRow = (r) => r.groups.filter((g) => g.type === 'exit').map((g) => `${g.name} ${g.count}`).join(' · ');
  const body = head + pa.svg + pb.svg + kp(40, 'Evacuation time (RSET)', ra.rset, rb.rset, ' s') + kp(360, '95 % evacuated', ra.t95, rb.t95, ' s') + kp(680, 'Peak density', ra.peakDensity.value, rb.peakDensity.value, ' p/m²', 2) + kp(1000, 'Mean time queuing', ra.meanQueue, rb.meanQueue, ' s')
    + `<text x="40" y="870" fill="${C.ink3}" font-family="${MONO}" font-size="12">Exit use before: ${esc(exitRow(ra))}</text><text x="40" y="892" fill="${C.ink3}" font-family="${MONO}" font-size="12">Exit use after:  ${esc(exitRow(rb))}</text>` + legend(40, 940, 'PEAK DENSITY');
  writeFileSync(new URL('04-before-after.svg', OUT), frame(1600, 1000, '04 · Before / after redesign', 'Two full runs with identical occupants, seats and reaction times (200 people, seed 406). Only the layout differs.', body));
  normalRun = { ra, rb };
}

// ------------------------------------------------------------------ technical illustrations
const wrapIll = (inner, vw, vh, title, caption) => {
  const W = 1600, H = 1000;
  const sc = Math.min((W - 80) / vw, (H - 190) / vh);
  const body = `<g transform="translate(${(W - vw * sc) / 2} ${100}) scale(${sc})">${inner.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`;
  return frame(W, H, title, caption, body);
};
const vb = (svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
{
  const d = dijkstra({ big: true }); const [w, h] = vb(d);
  writeFileSync(new URL('05-dijkstra.svg', OUT), wrapIll(d, w, h, '05 · Dijkstra distance field', 'Distances computed by EvacPrint’s Dijkstra routine from the exit (teal). The amber path follows decreasing cost from the start.'));
  const a = abm({ big: true }); const [w2, h2] = vb(a);
  writeFileSync(new URL('06-agent-based-model.svg', OUT), wrapIll(a, w2, h2, '06 · Agent-based modelling', 'Each occupant is an agent with its own speed, size, reaction time and target exit, moving through four states.'));
  const b = bottleneckId({ big: true }); const [w3, h3] = vb(b);
  writeFileSync(new URL('07-bottleneck-detection.svg', OUT), wrapIll(b, w3, h3, '07 · Bottleneck detection', 'Threshold the density field at Fruin LOS F, group touching cells, keep zones that persist, rank by exposure × peak.'));
}
void distanceField;
console.log('Wrote 7 illustrations to ./illustrations', normalRun ? `(before/after: ${normalRun.ra.rset} s → ${normalRun.rb.rset} s)` : '');
