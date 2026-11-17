// EvacPrint illustration library — one drafting style for every diagram:
// warm-white linework on charcoal, teal for safe flow, amber for caution,
// red for danger, mono annotations. Where possible the figures are computed
// (e.g. the Dijkstra figure runs the real search), not drawn by hand.
import { dijkstraTrace } from '../sim/pathfinding.js';
import { weidmannFactor } from '../sim/engine.js';

const TEAL = '#2fb8a6', AMBER = '#e3a03a', RED = '#e0524a', INK = '#ece6da', INK2 = '#b4ada1', INK3 = '#847e74', LINE = 'rgba(236,230,218,0.14)', FLOOR = '#191c20', BG = '#131619';
const D = ['#3b9a5c', '#c9a62c', '#e07b2a', '#c93a3a'];

const svg = (w, h, body, label) => `<svg class="ill" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg"><defs>
<marker id="ah-t" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${TEAL}"/></marker>
<marker id="ah-i" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${INK2}"/></marker>
<marker id="ah-a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${AMBER}"/></marker>
<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(236,230,218,0.18)" stroke-width="1.2"/></pattern>
<radialGradient id="hot"><stop offset="0" stop-color="${RED}" stop-opacity=".85"/><stop offset=".45" stop-color="${D[2]}" stop-opacity=".6"/><stop offset=".75" stop-color="${D[1]}" stop-opacity=".3"/><stop offset="1" stop-color="${D[0]}" stop-opacity="0"/></radialGradient>
<radialGradient id="warm"><stop offset="0" stop-color="${D[1]}" stop-opacity=".55"/><stop offset="1" stop-color="${D[0]}" stop-opacity="0"/></radialGradient>
</defs><rect width="${w}" height="${h}" fill="${BG}"/>${body}</svg>`;

const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" fill="${o.c || INK3}" font-family="IBM Plex Mono, monospace" font-size="${o.size || 9}" text-anchor="${o.a || 'start'}" ${o.w ? `font-weight="${o.w}"` : ''} letter-spacing="${o.ls ?? 0.3}">${s}</text>`;
const dot = (x, y, r, c) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${c}"/>`;
const wall = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${INK}" opacity=".85"/>`;

// deterministic pseudo-random for layouts of dots
function prng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

// ---------------------------------------------------------------- 1 congestion at a narrow exit
export function congestion() {
  let b = `<rect x="30" y="30" width="230" height="140" fill="${FLOOR}"/>`;
  b += wall(26, 26, 238, 4) + wall(26, 170, 238, 4) + wall(26, 26, 4, 148) + wall(260, 26, 4, 64) + wall(260, 110, 4, 64);
  b += `<circle cx="262" cy="100" r="70" fill="url(#hot)"/>`;
  // arch of people around the door
  for (let ring = 0; ring < 6; ring++) {
    const r = 11 + ring * 10;
    const n = Math.round((Math.PI * r) / 9.5);
    for (let k = 0; k <= n; k++) {
      const a = Math.PI / 2 + (k / n) * Math.PI;
      const x = 258 + Math.cos(a) * r, y = 100 + Math.sin(a) * r;
      if (x < 34 || y < 34 || y > 166) continue;
      b += dot(x, y, 3.2, ring < 2 ? '#f06d64' : ring < 4 ? AMBER : INK);
    }
  }
  const rnd = prng(3);
  for (let i = 0; i < 30; i++) b += dot(45 + rnd() * 120, 40 + rnd() * 120, 3, INK);
  b += `<path d="M270 100h34" stroke="${TEAL}" stroke-width="2" marker-end="url(#ah-t)"/>`;
  b += txt(272, 88, '0.9 m', { c: INK2 });
  b += txt(196, 186, 'ARCH FORMS AT THE DOOR', { c: RED, a: 'middle' });
  b += txt(40, 22, 'ARRIVAL RATE > DOOR CAPACITY → QUEUE', { c: INK3 });
  return svg(320, 200, b, 'Crowd forming an arch at a narrow exit');
}

// ---------------------------------------------------------------- 2 floor-plan digitisation
export function digitize() {
  let b = '';
  // left: drawing
  b += `<rect x="18" y="40" width="120" height="120" fill="none" stroke="${INK}" stroke-width="3"/>`;
  b += `<rect x="30" y="50" width="96" height="18" fill="url(#hatch)" stroke="${INK3}"/>` + txt(78, 62, 'STAGE', { a: 'middle', size: 7 });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) b += `<rect x="${32 + c * 12 + (c > 3 ? 6 : 0)}" y="${82 + r * 16}" width="8" height="7" rx="1.5" fill="#3a4048"/>`;
  b += `<rect x="60" y="158" width="20" height="5" fill="${BG}"/><path d="M60 160 a20 20 0 0 1 20 20" fill="none" stroke="${INK3}" stroke-dasharray="2 2"/><path d="M60 160v20" stroke="${INK2}"/>`;
  b += txt(78, 32, 'MEASURED PLAN', { a: 'middle' });
  b += `<path d="M146 100h28" stroke="${TEAL}" stroke-width="2" marker-end="url(#ah-t)"/>`;
  // right: grid
  const g = 10, ox = 184, oy = 40;
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      let c = FLOOR;
      if (x === 0 || y === 0 || x === 11 || y === 11) c = INK;
      if (y === 11 && (x === 4 || x === 5)) c = TEAL;
      if (y >= 1 && y <= 2 && x >= 1 && x <= 10) c = '#2a3036';
      if (y >= 4 && y <= 9 && y % 2 === 0 && x >= 1 && x <= 10 && x !== 5 && x !== 6) c = '#4a525b';
      b += `<rect x="${ox + x * g}" y="${oy + y * g}" width="${g - 1}" height="${g - 1}" fill="${c}" ${c === INK ? 'opacity=".85"' : ''}/>`;
    }
  b += txt(244, 32, '0.5 m GRID', { a: 'middle' });
  const leg = [[INK, 'wall'], ['#4a525b', 'seat'], [FLOOR, 'floor'], [TEAL, 'exit']];
  leg.forEach(([c, l], i) => { b += `<rect x="${44 + i * 64}" y="178" width="8" height="8" fill="${c}" stroke="${LINE}"/>` + txt(56 + i * 64, 185.5, l); });
  return svg(320, 200, b, 'Floor plan converted to a grid of cell types');
}

// ---------------------------------------------------------------- 3 grid movement
export function gridMove() {
  let b = '';
  const g = 34, ox = 75, oy = 22;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const blocked = (x === 3 && y === 1);
    b += `<rect x="${ox + x * g}" y="${oy + y * g}" width="${g - 2}" height="${g - 2}" fill="${blocked ? 'url(#hatch)' : FLOOR}" stroke="${LINE}"/>`;
  }
  b += `<rect x="${ox + 3 * g}" y="${oy + g}" width="${g - 2}" height="${g - 2}" fill="#2b3036" stroke="${INK3}"/>`;
  const cx = ox + 2 * g + 15, cy = oy + 2 * g + 15;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const diag = dx && dy;
    const cut = dx === 1 && dy === -1; // corner cutting past the obstacle
    const ex = cx + dx * (g - 6), ey = cy + dy * (g - 6);
    b += `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="${cut ? RED : diag ? AMBER : TEAL}" stroke-width="1.6" ${cut ? 'stroke-dasharray="3 3"' : ''} marker-end="url(#${cut ? 'ah-i' : diag ? 'ah-a' : 'ah-t'})"/>`;
    if (!cut) b += txt(cx + dx * (g + 6), cy + dy * (g + 6) + 3, diag ? '√2' : '1', { c: diag ? AMBER : TEAL, a: 'middle', size: 9.5 });
  }
  b += `<line x1="${cx + 26}" y1="${cy - 36}" x2="${cx + 36}" y2="${cy - 26}" stroke="${RED}" stroke-width="2"/><line x1="${cx + 36}" y1="${cy - 36}" x2="${cx + 26}" y2="${cy - 26}" stroke="${RED}" stroke-width="2"/>`;
  b += dot(cx, cy, 7, INK);
  b += txt(250, 52, '8 NEIGHBOURS', { c: INK2 });
  b += txt(250, 68, 'straight = 0.5 m', { c: TEAL });
  b += txt(250, 82, 'diagonal = 0.71 m', { c: AMBER });
  b += txt(250, 96, 'no corner cutting', { c: RED });
  return svg(320, 200, b, 'Agent on a grid with eight movement directions');
}

// ---------------------------------------------------------------- 4 Dijkstra (computed)
export function dijkstra({ big = false } = {}) {
  const w = 10, h = 7;
  const open = new Uint8Array(w * h).fill(1);
  for (const [x, y] of [[4, 1], [4, 2], [4, 3], [4, 4], [6, 3], [6, 4], [6, 5], [6, 6]]) open[y * w + x] = 0;
  const src = 3 * w + 0, goal = 1 * w + 9;
  const { dist, order } = dijkstraTrace(w, h, open, goal, -1); // full field
  const { path } = dijkstraTrace(w, h, open, goal, src); // shortest path to the start
  const g = big ? 46 : 26, ox = big ? 40 : 30, oy = big ? 44 : 30;
  let maxD = 0;
  for (let i = 0; i < w * h; i++) if (isFinite(dist[i])) maxD = Math.max(maxD, dist[i]);
  let b = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!open[i]) { b += `<rect x="${ox + x * g}" y="${oy + y * g}" width="${g - 2}" height="${g - 2}" fill="${INK}" opacity=".85"/>`; continue; }
    const d = dist[i];
    const t = isFinite(d) ? d / maxD : 1;
    b += `<rect x="${ox + x * g}" y="${oy + y * g}" width="${g - 2}" height="${g - 2}" fill="rgba(47,184,166,${(0.55 * (1 - t) + 0.04).toFixed(3)})" stroke="${LINE}"/>`;
    if (isFinite(d)) b += txt(ox + x * g + (g - 2) / 2, oy + y * g + g / 2 + 2.5, d.toFixed(1), { a: 'middle', size: big ? 10 : 7, c: t < 0.35 ? INK : INK2 });
  }
  const pts = path.map((c) => [ox + (c % w) * g + (g - 2) / 2, oy + Math.floor(c / w) * g + (g - 2) / 2]);
  // path from the start (src) to the exit (goal) — dijkstraTrace ran from goal, so reverse
  const pl = pts.reverse().map((p) => p.join(',')).join(' ');
  b += `<polyline points="${pl}" fill="none" stroke="${AMBER}" stroke-width="${big ? 3 : 2}" stroke-linejoin="round" marker-end="url(#ah-a)"/>`;
  const [sx, sy] = [ox + (src % w) * g + (g - 2) / 2, oy + Math.floor(src / w) * g + (g - 2) / 2];
  const [gx, gy] = [ox + (goal % w) * g + (g - 2) / 2, oy + Math.floor(goal / w) * g + (g - 2) / 2];
  b += `<circle cx="${sx}" cy="${sy}" r="${big ? 9 : 6}" fill="${INK}" stroke="${BG}" stroke-width="2"/>`;
  b += `<rect x="${gx - (big ? 10 : 7)}" y="${gy - (big ? 10 : 7)}" width="${big ? 20 : 14}" height="${big ? 20 : 14}" rx="3" fill="${TEAL}"/>`;
  const W = ox * 2 + w * g, H = oy + h * g + (big ? 50 : 36);
  b += txt(ox, oy - (big ? 16 : 10), big ? 'DISTANCE TO EXIT, IN CELLS — computed by the EvacPrint Dijkstra routine' : 'DISTANCE TO EXIT (cells)', { size: big ? 10 : 8 });
  b += txt(ox, oy + h * g + (big ? 22 : 16), `${order.length} cells settled · start → exit cost ${dist[src].toFixed(2)} · agents walk downhill`, { c: INK2, size: big ? 10 : 8 });
  return svg(W, H, b, 'Dijkstra distance field with the shortest path to the exit');
}

// ---------------------------------------------------------------- 5 agent-based simulation
export function abm({ big = false } = {}) {
  const W = big ? 640 : 320, H = big ? 300 : 200, k = big ? 2 : 1;
  let b = '';
  const states = [['Waiting', 'reaction time', INK3], ['Walking', 'follows field', TEAL], ['Queuing', 'door capacity', AMBER], ['Evacuated', 'logs exit time', INK]];
  const y = big ? 210 : 150;
  states.forEach(([n, s, c], i) => {
    const x = (big ? 40 : 14) + i * (big ? 150 : 76);
    const bw = big ? 120 : 66;
    b += `<rect x="${x}" y="${y}" width="${bw}" height="${big ? 50 : 34}" rx="6" fill="#1c2025" stroke="${c}"/>`;
    b += txt(x + bw / 2, y + (big ? 22 : 15), n.toUpperCase(), { a: 'middle', c, size: big ? 11 : 8, w: 600 });
    b += txt(x + bw / 2, y + (big ? 38 : 27), s, { a: 'middle', size: big ? 9.5 : 7 });
    if (i < 3) b += `<path d="M${x + bw + 2} ${y + (big ? 25 : 17)}h${(big ? 150 : 76) - bw - 6}" stroke="${INK2}" stroke-width="1.3" marker-end="url(#ah-i)"/>`;
  });
  // the agent card
  const cx = big ? 150 : 70, cy = big ? 100 : 72;
  b += `<circle cx="${cx}" cy="${cy}" r="${22 * k * 0.8}" fill="none" stroke="${INK3}" stroke-dasharray="3 3"/>`;
  b += dot(cx, cy, 10 * k * 0.8, INK);
  b += `<path d="M${cx} ${cy}l${26 * k} ${-12 * k}" stroke="${TEAL}" stroke-width="2" marker-end="url(#ah-t)"/>`;
  b += txt(cx + 30 * k, cy - 16 * k, 'v = v₀·f(ρ)', { c: TEAL, size: big ? 11 : 8 });
  b += txt(cx - 30 * k, cy + 36 * k, 'r = 0.22 m body', { size: big ? 10 : 7.5 });
  const attrs = [['v₀', '1.0–1.6 m/s'], ['reaction', '10–30 s'], ['profile', 'adult · slow · wheelchair'], ['target', 'lowest-cost exit']];
  attrs.forEach(([a, v], i) => {
    const ax = big ? 330 : 170, ay = (big ? 60 : 36) + i * (big ? 28 : 20);
    b += txt(ax, ay, a.toUpperCase(), { c: INK3, size: big ? 10 : 7.5 });
    b += txt(ax + (big ? 90 : 52), ay, v, { c: INK, size: big ? 10.5 : 8 });
  });
  b += txt(big ? 330 : 170, big ? 30 : 20, 'EACH AGENT CARRIES ITS OWN STATE', { size: big ? 10 : 7.5, c: INK2 });
  return svg(W, H, b, 'Agent attributes and the four-state lifecycle');
}

// ---------------------------------------------------------------- 6 density heatmap
export function densityHeat() {
  let b = '';
  const rnd = prng(11);
  const pts = [];
  for (let i = 0; i < 46; i++) {
    const t = rnd();
    const x = 40 + Math.pow(t, 0.55) * 210 + rnd() * 10, y = 100 + (rnd() - 0.5) * (130 - Math.pow(t, 0.6) * 90);
    pts.push([x, y]);
  }
  // kernel density evaluated on a grid (the real formula, in pixel units)
  const R = 22;
  for (let gy = 30; gy < 170; gy += 10) for (let gx = 30; gx < 270; gx += 10) {
    let s = 0;
    for (const [x, y] of pts) s += Math.exp(-((x - gx - 5) ** 2 + (y - gy - 5) ** 2) / (R * R));
    const band = s < 1.1 ? 0 : s < 2.2 ? 1 : s < 3.6 ? 2 : 3;
    const a = Math.min(0.85, s * 0.22);
    if (a > 0.04) b += `<rect x="${gx}" y="${gy}" width="10" height="10" fill="${D[band]}" opacity="${a.toFixed(2)}"/>`;
  }
  for (const [x, y] of pts) b += dot(x, y, 2.6, INK);
  b += `<circle cx="150" cy="100" r="${R}" fill="none" stroke="${TEAL}" stroke-dasharray="3 3"/>`;
  b += txt(150, 72, 'kernel R = 0.7 m', { c: TEAL, a: 'middle', size: 8 });
  b += wall(270, 30, 4, 52) + wall(270, 118, 4, 52);
  b += txt(20, 188, 'ρ(x) = Σ exp(−|xᵢ−x|²/R²) / πR²', { c: INK2, size: 8.5 });
  D.forEach((c, i) => { b += `<rect x="${206 + i * 26}" y="181" width="22" height="7" fill="${c}"/>`; });
  return svg(320, 200, b, 'Agent positions turned into a density heatmap');
}

// ---------------------------------------------------------------- 7 bottleneck identification
export function bottleneckId({ big = false } = {}) {
  const W = big ? 640 : 320, H = big ? 300 : 200;
  const k = big ? 2 : 1;
  let b = '';
  // field
  b += `<rect x="${20 * k}" y="${30 * k}" width="${170 * k}" height="${120 * k}" fill="${FLOOR}"/>`;
  b += `<ellipse cx="${150 * k}" cy="${90 * k}" rx="${55 * k}" ry="${40 * k}" fill="url(#hot)"/>`;
  b += `<ellipse cx="${70 * k}" cy="${60 * k}" rx="${35 * k}" ry="${22 * k}" fill="url(#warm)"/>`;
  b += `<path d="M${118 * k} ${78 * k} q${18 * k} ${-24 * k} ${44 * k} ${-6 * k} q${18 * k} ${16 * k} ${-2 * k} ${36 * k} q${-26 * k} ${16 * k} ${-42 * k} ${-6 * k}z" fill="none" stroke="#ff7b72" stroke-width="${1.6 * k}" stroke-dasharray="${4 * k} ${3 * k}"/>`;
  b += `<rect x="${158 * k}" y="${50 * k}" width="${22 * k}" height="${13 * k}" rx="${6 * k}" fill="#c93a3a"/>` + txt(169 * k, 59.5 * k, 'B1', { c: '#fff', a: 'middle', size: 8 * k, w: 600 });
  b += wall(190 * k, 30 * k, 4 * k, 46 * k) + wall(190 * k, 104 * k, 4 * k, 46 * k);
  b += txt(20 * k, 22 * k, 'DENSITY ≥ 2.15 p/m² (LOS F)', { size: 8 * k, c: INK2 });
  // steps
  const steps = ['threshold the density field', 'group touching cells', 'keep zones ≥ 3 s at LOS F', 'rank by exposure × peak'];
  steps.forEach((s, i) => {
    const y = (44 + i * 26) * k;
    b += `<circle cx="${212 * k}" cy="${y - 3 * k}" r="${7 * k}" fill="none" stroke="${i === 3 ? RED : TEAL}"/>` + txt(212 * k, y, `${i + 1}`, { a: 'middle', c: INK, size: 8 * k });
    b += txt(224 * k, y, s, { c: INK, size: 7.6 * k });
  });
  // persistence bar
  b += `<rect x="${20 * k}" y="${164 * k}" width="${170 * k}" height="${8 * k}" rx="${2 * k}" fill="#22272d"/>`;
  b += `<rect x="${72 * k}" y="${164 * k}" width="${88 * k}" height="${8 * k}" rx="${2 * k}" fill="${RED}" opacity=".8"/>`;
  b += txt(20 * k, 186 * k, 'time above threshold at B1', { size: 7.5 * k });
  return svg(W, H, b, 'How EvacPrint identifies bottlenecks from the density field');
}

// ---------------------------------------------------------------- 8 normal vs blocked
export function normalVsBlocked() {
  const room = (ox, blocked) => {
    let b = `<rect x="${ox}" y="40" width="130" height="110" fill="${FLOOR}"/>`;
    b += wall(ox - 3, 37, 136, 3) + wall(ox - 3, 150, 136, 3) + wall(ox - 3, 37, 3, 116);
    b += wall(ox + 130, 37, 3, 20) + wall(ox + 130, 75, 3, 38) + wall(ox + 130, 131, 3, 22);
    if (blocked) b += `<rect x="${ox + 128}" y="113" width="8" height="18" fill="${RED}" opacity=".7"/><path d="M${ox + 126} 111l12 22M${ox + 138} 111l-12 22" stroke="${RED}" stroke-width="2"/>`;
    if (blocked) b += `<ellipse cx="${ox + 120}" cy="66" rx="34" ry="28" fill="url(#hot)"/>`;
    const rnd = prng(blocked ? 7 : 5);
    for (let i = 0; i < 26; i++) {
      const y = 48 + rnd() * 96, x = ox + 10 + rnd() * 100;
      const toTop = blocked || y < 95;
      b += dot(x, y, 2.6, INK);
      if (i % 3 === 0) b += `<path d="M${x} ${y}L${x + (ox + 128 - x) * 0.35} ${y + ((toTop ? 66 : 122) - y) * 0.35}" stroke="${toTop && blocked ? AMBER : TEAL}" stroke-width="1.1" marker-end="url(#ah-${toTop && blocked ? 'a' : 't'})" opacity=".85"/>`;
    }
    if (blocked) for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const a = Math.PI / 2 + (k / 5) * Math.PI; b += dot(ox + 128 + Math.cos(a) * (8 + r * 7), 66 + Math.sin(a) * (8 + r * 7), 2.6, r === 0 ? '#f06d64' : AMBER); }
    return b;
  };
  let b = room(20, false) + room(170, true);
  b += txt(85, 28, 'BOTH EXITS OPEN', { a: 'middle', c: TEAL });
  b += txt(235, 28, 'LOWER EXIT BLOCKED', { a: 'middle', c: RED });
  b += txt(85, 172, 'load splits by distance', { a: 'middle' });
  b += txt(235, 172, 'everyone reroutes → queue', { a: 'middle' });
  return svg(320, 190, b, 'Normal evacuation compared with a blocked exit');
}

// ---------------------------------------------------------------- 9 door width
export function doorWidth() {
  const door = (ox, wPx, label, flow) => {
    let b = `<rect x="${ox}" y="34" width="110" height="100" fill="${FLOOR}"/>`;
    b += wall(ox, 134, 55 - wPx / 2, 4) + wall(ox + 55 + wPx / 2, 134, 55 - wPx / 2, 4);
    const q = wPx < 30 ? 5 : 2;
    b += `<ellipse cx="${ox + 55}" cy="128" rx="${44 - wPx / 4}" ry="${q * 9}" fill="url(#${q > 3 ? 'hot' : 'warm'})"/>`;
    for (let r = 0; r < q; r++) for (let k = 0; k < 7; k++) { const a = Math.PI + (k / 6) * Math.PI; b += dot(ox + 55 + Math.cos(a) * (wPx / 2 + 6 + r * 8), 130 + Math.sin(a) * (6 + r * 8), 2.5, r < 2 && q > 3 ? '#f06d64' : INK); }
    const arrows = wPx < 30 ? 1 : 2;
    for (let a = 0; a < arrows; a++) b += `<path d="M${ox + 55 + (arrows > 1 ? (a ? 8 : -8) : 0)} 140v22" stroke="${TEAL}" stroke-width="2" marker-end="url(#ah-t)"/>`;
    b += txt(ox + 55, 26, label, { a: 'middle', c: INK2 });
    b += txt(ox + 55, 182, flow, { a: 'middle', c: TEAL });
    return b;
  };
  let b = door(25, 22, '0.9 m DOOR', '≈ 1.2 persons/s');
  b += door(185, 44, '1.8 m DOOR', '≈ 2.4 persons/s');
  b += txt(160, 196, 'capacity ∝ clear width (1.33 p/s per metre)', { a: 'middle', size: 8 });
  return svg(320, 204, b, 'Doubling door width doubles its discharge capacity');
}

// ---------------------------------------------------------------- 10 before / after
export function beforeAfter() {
  const plan = (ox, after) => {
    let b = `<rect x="${ox}" y="36" width="126" height="110" fill="${FLOOR}"/>`;
    b += wall(ox - 3, 33, 132, 3) + wall(ox - 3, 33, 3, 116) + wall(ox + 126, 33, 3, 116);
    const dw = after ? 26 : 13;
    b += wall(ox - 3, 146, 30, 3) + wall(ox + 27 + dw, 146, 99 - dw, 3);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) b += `<rect x="${ox + 10 + c * 12}" y="${48 + r * 16}" width="8" height="6" rx="1.5" fill="#3a4048"/>`;
    b += `<ellipse cx="${ox + 27 + dw / 2}" cy="140" rx="${after ? 18 : 36}" ry="${after ? 9 : 22}" fill="url(#${after ? 'warm' : 'hot'})"/>`;
    b += `<path d="M${ox + 27 + dw / 2} 150v18" stroke="${TEAL}" stroke-width="${after ? 3 : 1.6}" marker-end="url(#ah-t)"/>`;
    return b;
  };
  let b = plan(24, false) + plan(170, true);
  b += `<path d="M154 92h12" stroke="${INK2}" stroke-width="1.6" marker-end="url(#ah-i)"/>`;
  b += txt(87, 24, 'BEFORE', { a: 'middle', c: RED }) + txt(233, 24, 'AFTER: DOOR WIDENED', { a: 'middle', c: TEAL });
  b += txt(160, 188, 'same crowd, same seed — only the layout changes', { a: 'middle', size: 8 });
  return svg(320, 196, b, 'Layout before and after widening a bottleneck door');
}

// ---------------------------------------------------------------- density–speed curve (Weidmann)
export function speedDensity({ marker = null } = {}) {
  const W = 320, H = 200, ox = 40, oy = 20, iw = 250, ih = 140;
  let b = '';
  for (let v = 0; v <= 1.4; v += 0.35) b += `<line x1="${ox}" x2="${ox + iw}" y1="${oy + ih - (v / 1.4) * ih}" y2="${oy + ih - (v / 1.4) * ih}" stroke="${LINE}"/>` + txt(ox - 6, oy + ih - (v / 1.4) * ih + 3, v.toFixed(2), { a: 'end', size: 7.5 });
  for (let r = 0; r <= 6; r++) b += txt(ox + (r / 6) * iw, oy + ih + 14, `${r}`, { a: 'middle', size: 7.5 });
  [[0, 1.08, 0], [1.08, 2.15, 1], [2.15, 4, 2], [4, 6, 3]].forEach(([a, c, i]) => { b += `<rect x="${ox + (a / 6) * iw}" y="${oy + ih + 1}" width="${((c - a) / 6) * iw}" height="4" fill="${D[i]}"/>`; });
  let d = '';
  for (let r = 0.05; r <= 6; r += 0.05) { const v = 1.34 * weidmannFactor(r); d += `${d ? 'L' : 'M'}${(ox + (r / 6) * iw).toFixed(1)},${(oy + ih - (v / 1.4) * ih).toFixed(1)}`; }
  b += `<path d="${d}" fill="none" stroke="${TEAL}" stroke-width="2"/>`;
  if (marker != null) { const v = 1.34 * weidmannFactor(marker); b += dot(ox + (marker / 6) * iw, oy + ih - (v / 1.4) * ih, 5, AMBER); }
  b += txt(ox, oy - 6, 'WALKING SPEED (m/s)', { size: 7.5 });
  b += txt(ox + iw, oy + ih + 28, 'DENSITY (persons/m²)', { a: 'end', size: 7.5 });
  b += txt(ox + iw - 4, oy + 18, 'Weidmann (1993)', { a: 'end', c: INK2, size: 8 });
  return svg(W, H + 10, b, 'Walking speed falls as crowd density rises');
}

// ---------------------------------------------------------------- story art
export function storyArt(kind) {
  switch (kind) {
    case 'risk': return congestion();
    case 'digitize': return digitize();
    case 'simulate': return abm();
    case 'detect': return bottleneckId();
    case 'test': case 'optimise': return testVariants();
    case 'recommend': return ranking();
    case 'report': return reportArt();
    default: return congestion();
  }
}

function testVariants() {
  let b = '';
  const items = [['Baseline', RED, 0], ['Widen door', TEAL, 1], ['Add exit', TEAL, 2], ['Move desk', AMBER, 3]];
  items.forEach(([n, c, i]) => {
    const x = 16 + (i % 2) * 150, y = 22 + Math.floor(i / 2) * 86;
    b += `<rect x="${x}" y="${y}" width="138" height="74" rx="6" fill="#1c2025" stroke="${i === 0 ? LINE : c}"/>`;
    b += `<rect x="${x + 10}" y="${y + 18}" width="70" height="46" fill="${FLOOR}" stroke="${INK3}"/>`;
    b += `<circle cx="${x + 70}" cy="${y + 58}" r="${i === 0 ? 16 : i === 3 ? 11 : 8}" fill="url(#${i === 0 ? 'hot' : 'warm'})"/>`;
    b += txt(x + 10, y + 12, n.toUpperCase(), { c: INK2, size: 7.5 });
    b += `<rect x="${x + 90}" y="${y + 18}" width="38" height="${i === 0 ? 46 : i === 3 ? 38 : 28}" fill="${c}" opacity=".7" transform="translate(0 ${i === 0 ? 0 : i === 3 ? 8 : 18})"/>`;
  });
  return svg(320, 200, b, 'Several layout variants simulated and compared');
}
function ranking() {
  let b = txt(20, 26, 'RANKED BY SECONDS SAVED', { c: INK2 });
  [['Add an exit', 0.92], ['Widen a door', 0.74], ['Clear an obstruction', 0.52], ['Remove a seat row', 0.16]].forEach(([n, v], i) => {
    const y = 44 + i * 36;
    b += `<circle cx="28" cy="${y + 7}" r="9" fill="none" stroke="${i === 0 ? TEAL : INK3}"/>` + txt(28, y + 10, `${i + 1}`, { a: 'middle', c: INK });
    b += txt(46, y + 4, n, { c: INK, size: 8.5 });
    b += `<rect x="46" y="${y + 9}" width="240" height="6" rx="3" fill="#22272d"/><rect x="46" y="${y + 9}" width="${240 * v}" height="6" rx="3" fill="${i < 3 ? TEAL : INK3}"/>`;
  });
  return svg(320, 200, b, 'Design changes ranked by evacuation time saved');
}
function reportArt() {
  let b = `<rect x="70" y="16" width="180" height="172" rx="6" fill="#1c2025" stroke="${LINE}"/>`;
  b += txt(86, 36, 'EVACUATION REPORT', { c: INK, size: 8.5, w: 600 });
  b += `<rect x="86" y="46" width="66" height="34" rx="4" fill="${FLOOR}"/>` + txt(92, 60, 'RSET', { size: 7 }) + `<rect x="92" y="68" width="44" height="6" rx="3" fill="${INK}"/>`;
  b += `<rect x="168" y="46" width="66" height="34" rx="4" fill="${FLOOR}"/>` + txt(174, 60, 'PEAK', { size: 7 }) + txt(174, 74, 'LOS F', { c: RED, size: 10 });
  b += `<path d="M86 150 C110 148 120 110 150 104 S200 92 234 90" fill="none" stroke="${TEAL}" stroke-width="2"/>`;
  b += `<line x1="86" y1="150" x2="234" y2="150" stroke="${LINE}"/>`;
  for (let i = 0; i < 3; i++) b += `<rect x="86" y="${158 + i * 9}" width="${120 - i * 26}" height="4" rx="2" fill="${INK3}"/>`;
  return svg(320, 200, b, 'A generated evacuation report');
}

export const CONCEPTS = [
  { id: 'congestion', title: 'Crowd congestion at narrow exits', caption: 'When people arrive faster than a door can discharge them, a queue forms and bends into an arch around the opening — the densest, most dangerous spot in the room.', art: congestion },
  { id: 'digitize', title: 'Floor-plan digitisation', caption: 'A measured plan becomes a grid of 0.5 m cells, each typed as wall, floor, seat, stage, door or exit. Every later computation runs on this grid.', art: digitize },
  { id: 'grid', title: 'Grid-based movement', caption: 'Agents can head toward any of 8 neighbouring cells. Diagonal steps cost √2 times more, and squeezing diagonally past a corner is not allowed.', art: gridMove },
  { id: 'dijkstra', title: 'BFS / Dijkstra pathfinding', caption: 'Starting from the exits, Dijkstra assigns every cell its walking distance to safety. Agents simply walk downhill on this field — no per-person search needed.', art: dijkstra },
  { id: 'abm', title: 'Agent-based simulation', caption: 'Each occupant is an independent agent with its own speed, reaction time, body size and target exit, moving through Waiting → Walking → Queuing → Evacuated.', art: abm },
  { id: 'heat', title: 'Crowd density heatmaps', caption: 'Density at every point is a Gaussian-weighted count of nearby people per square metre. Colours follow Fruin’s levels of service.', art: densityHeat },
  { id: 'bottleneck', title: 'Bottleneck identification', caption: 'Cells above 2.15 p/m² are grouped into zones; zones that stay critical for several seconds are ranked as bottlenecks.', art: bottleneckId },
  { id: 'blocked', title: 'Normal versus blocked exit', caption: 'Block one exit and the whole crowd reroutes to the remaining doors, overloading them — the classic cause of crushes.', art: normalVsBlocked },
  { id: 'width', title: 'Door width optimisation', caption: 'A door’s discharge capacity grows with its clear width — about 1.33 persons per second per metre — so widening the critical door shortens the queue directly.', art: doorWidth },
  { id: 'before-after', title: 'Before-and-after layout', caption: 'The same occupants, seats and reaction times are simulated on both layouts, so any difference is caused by the design change alone.', art: beforeAfter },
];
