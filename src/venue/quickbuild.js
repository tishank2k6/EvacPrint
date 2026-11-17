// Quick room builder: turns a few measurements into a complete blueprint
// (walls, stage, seating blocks with aisles, emergency exits) without AI.
// Everything it draws is ordinary editable shapes; the engine, 3D model and
// reports treat it exactly like a hand-drawn venue.
import { icon } from '../ui/icons.js';
import { esc, openModal } from '../ui/dom.js';
import { newShape, rasterize, validate, defaultConfig, CELL } from './model.js';
import { renderStaticPlan } from '../render/floorplan.js';

const MARGIN = 1; // metres of outside space around the room
const SIDE_AISLE = 1.2; // clear width kept along side walls (keeps side exits open)
const CROSS_AISLE = 1.5; // clear depth in front of the seats and along the back wall
const CENTRE_AISLE = 1.2;
const snap = (v) => Math.round(v / CELL) * CELL;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const WALLS = [['front', 'Front wall (stage side)'], ['back', 'Back wall'], ['left', 'Left wall'], ['right', 'Right wall']];

export const QUICK_DEFAULTS = { name: 'Main room', width: 12, depth: 9, stage: true, seating: true, pitch: 1, exits: { front: 0, back: 1, left: 1, right: 0 }, exitWidth: 1, people: '', measured: false };

/**
 * Place n openings of width ew evenly over the free stretches of one wall.
 * intervals: [[from, to]] in metres along the wall. Returns start positions.
 */
function spread(intervals, n, ew) {
  const usable = intervals.map(([a, b]) => [a, b - ew]).filter(([a, b]) => b >= a);
  const L = usable.reduce((t, [a, b]) => t + (b - a), 0);
  const out = [];
  // evenly inset from the corners; when that is too tight, use the full length (corners included)
  const tight = n > 1 && L / (n + 1) < ew;
  for (let k = 1; k <= n; k++) {
    let t = tight ? (L * (k - 1)) / (n - 1) : (L * k) / (n + 1);
    for (const [a, b] of usable) {
      if (t <= b - a + 1e-9) { out.push(snap(a + t)); break; }
      t -= b - a;
    }
  }
  // drop overlaps (narrow walls with many exits)
  return out.filter((x, i) => i === 0 || x - out[i - 1] >= ew);
}

/** Pure geometry: measurements → { width, height, shapes, skipped } */
export function quickRoom(o) {
  const W = snap(clamp(+o.width || 0, 4, 150)), D = snap(clamp(+o.depth || 0, 4, 150));
  const rounded = Math.abs(W - +o.width) > 1e-6 || Math.abs(D - +o.depth) > 1e-6 || Math.abs(snap(clamp(+o.exitWidth || 1, 0.5, 4)) - +o.exitWidth) > 1e-6;
  const ew = snap(clamp(+o.exitWidth || 1, 0.5, 4));
  const x0 = MARGIN, y0 = MARGIN;
  const shapes = [newShape('room', x0, y0, { w: W, h: D, name: (o.name || 'Main room').trim() || 'Main room' })];
  const skipped = [];

  let stage = null;
  if (o.stage) {
    const sw = snap(W * 0.6), sd = snap(clamp(D * 0.18, 1.5, 4));
    stage = { x: snap(x0 + (W - sw) / 2), y: y0, w: sw, h: sd };
    shapes.push(newShape('stage', stage.x, stage.y, { w: sw, h: sd, name: 'Stage' }));
  }

  if (o.seating) {
    const sx0 = x0 + SIDE_AISLE, sx1 = x0 + W - SIDE_AISLE;
    const sy0 = stage ? stage.y + stage.h + CROSS_AISLE : y0 + CROSS_AISLE, sy1 = y0 + D - CROSS_AISLE;
    const span = sx1 - sx0;
    if (span >= 2 && sy1 - sy0 >= 1.5) {
      const blocks = span > 22 ? 3 : span > 9 ? 2 : 1;
      const bw = (span - CENTRE_AISLE * (blocks - 1)) / blocks;
      const names = blocks === 1 ? ['Seating'] : blocks === 2 ? ['Left seating', 'Right seating'] : ['Left seating', 'Centre seating', 'Right seating'];
      for (let i = 0; i < blocks; i++) {
        const bx = snap(sx0 + i * (bw + CENTRE_AISLE));
        shapes.push(newShape('seating', bx, snap(sy0), { w: snap(bw), h: snap(sy1 - sy0), pitch: +o.pitch === 1.5 ? 1.5 : 1, name: names[i] }));
      }
    } else skipped.push('seating (room too small after aisles)');
  }

  // exits: openings start at (x, y) and run along the wall line
  const gap = 0.3;
  const along = {
    front: stage ? [[x0 + gap, stage.x - gap], [stage.x + stage.w + gap, x0 + W - gap]] : [[x0 + gap, x0 + W - gap]],
    back: [[x0 + gap, x0 + W - gap]],
    left: [[y0 + gap, y0 + D - gap]],
    right: [[y0 + gap, y0 + D - gap]],
  };
  const label = { front: 'Front exit', back: 'Rear exit', left: 'Left exit', right: 'Right exit' };
  for (const [wall] of WALLS) {
    const n = clamp(Math.round(+o.exits?.[wall] || 0), 0, 6);
    if (!n) continue;
    const pos = spread(along[wall], n, ew);
    if (pos.length < n) skipped.push(`${n - pos.length} ${wall}-wall exit(s) (not enough free wall)`);
    pos.forEach((p, i) => {
      const name = pos.length > 1 ? `${label[wall]} ${i + 1}` : label[wall];
      if (wall === 'front') shapes.push(newShape('exit', p, y0, { width: ew, rot: 0, name }));
      if (wall === 'back') shapes.push(newShape('exit', p, y0 + D, { width: ew, rot: 0, name }));
      if (wall === 'left') shapes.push(newShape('exit', x0, p, { width: ew, rot: 90, name }));
      if (wall === 'right') shapes.push(newShape('exit', x0 + W, p, { width: ew, rot: 90, name }));
    });
  }
  return { width: W + 2 * MARGIN, height: D + 2 * MARGIN, shapes, skipped, W, D, ew, rounded };
}

/** Apply a quick-room result to a venue (in place, so editors holding the array stay valid). */
export function applyQuickRoom(venue, o) {
  const r = quickRoom(o);
  venue.plan.width = r.width;
  venue.plan.height = r.height;
  venue.plan.shapes.splice(0, venue.plan.shapes.length, ...r.shapes);
  venue.plan.scaleVerified = !!o.measured;
  venue.plan.unverified = o.measured ? [] : ['Room size typed in by the user without on-site verification'];
  venue.config.exits = {};
  const v = validate(venue);
  const seats = v.capacity.seats;
  const people = Math.round(+o.people) || (seats || Math.round(v.capacity.standing * CELL * CELL));
  venue.config.population.total = Math.max(1, people);
  venue.config.details.normalOcc = venue.config.population.total;
  venue.config.details.maxOcc = Math.max(venue.config.details.maxOcc || 0, venue.config.population.total);
  if (venue.name === 'Untitled venue' && o.name?.trim()) { venue.name = o.name.trim(); venue.config.details.name = venue.name; }
  return { ...r, validation: v, people: venue.config.population.total };
}

/** Modal UI with a live preview. onBuilt(result) runs after the venue was updated. */
export function openQuickBuilder(venue, { onBuilt, beforeApply } = {}) {
  const o = JSON.parse(JSON.stringify(venue.quick || QUICK_DEFAULTS));
  const num = (k, label, min, max, step, unit, val) => `<div class="field"><label for="qb-${k}">${label}${unit ? ` <span class="faint">(${unit})</span>` : ''}</label><input class="input" id="qb-${k}" data-k="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${esc(val)}"></div>`;
  const m = openModal({
    title: 'Quick room builder — no AI needed',
    wide: true,
    body: `<div class="qb">
      <form class="qb-form" novalidate>
        <p class="small muted">Type the room’s measurements; EvacPrint draws the walls, stage, seating with aisles and exits for you. Everything stays editable on the Blueprint tab. Use a tape measure or laser meter — or the floor plan — for real sizes.</p>
        <div class="field"><label for="qb-name">Room name</label><input class="input" id="qb-name" data-k="name" value="${esc(o.name)}"></div>
        <div class="grid2">${num('width', 'Width (left to right)', 4, 150, 0.25, 'm', o.width)}${num('depth', 'Depth (front to back)', 4, 150, 0.25, 'm', o.depth)}</div>
        <div class="row gap8 wrap-row">
          <label class="check"><input type="checkbox" data-k="stage" ${o.stage ? 'checked' : ''}>Stage / teaching area at the front</label>
          <label class="check"><input type="checkbox" data-k="seating" ${o.seating ? 'checked' : ''}>Fill with seating rows</label>
        </div>
        <div class="field"><label for="qb-pitch">Row spacing</label><select class="input" id="qb-pitch" data-k="pitch"><option value="1" ${+o.pitch !== 1.5 ? 'selected' : ''}>1.0 m — standard rows</option><option value="1.5" ${+o.pitch === 1.5 ? 'selected' : ''}>1.5 m — wide rows / desks</option></select></div>
        <div class="mini-h">Emergency exits per wall</div>
        <div class="qb-exits">${WALLS.map(([k, l]) => `<div class="field"><label for="qb-x-${k}">${l}</label><input class="input" id="qb-x-${k}" data-x="${k}" type="number" min="0" max="6" step="1" value="${o.exits[k] || 0}"></div>`).join('')}</div>
        <div class="grid2">${num('exitWidth', 'Clear width of each exit', 0.5, 4, 0.5, 'm, 0.5 m steps', o.exitWidth)}${num('people', 'People inside (blank = one per seat)', 1, 3000, 1, '', o.people)}</div>
        <label class="check"><input type="checkbox" data-k="measured" ${o.measured ? 'checked' : ''}>These sizes were measured on site</label>
      </form>
      <aside class="qb-side">
        <div class="qb-prev"><canvas aria-label="Blueprint preview"></canvas></div>
        <div class="qb-sum small" aria-live="polite"></div>
        <div class="row gap8 qb-act"><button class="btn" data-close>Cancel</button><button class="btn primary" data-build>${icon('cube')}Build blueprint &amp; 3D model</button></div>
      </aside>
    </div>`,
  });
  const root = m.body;
  const read = () => {
    root.querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' || i.dataset.k === 'pitch' ? (i.value === '' ? '' : +i.value) : i.value; });
    root.querySelectorAll('[data-x]').forEach((i) => { o.exits[i.dataset.x] = +i.value || 0; });
    root.querySelector('#qb-pitch').closest('.field').hidden = !o.seating;
  };
  const preview = () => {
    read();
    const sum = root.querySelector('.qb-sum');
    const btn = root.querySelector('[data-build]');
    if (!(o.width >= 4 && o.depth >= 4)) { sum.innerHTML = '<p class="error-text">Width and depth must be at least 4 m.</p>'; btn.disabled = true; return; }
    const r = quickRoom(o);
    const tmp = { plan: { width: r.width, height: r.height, shapes: r.shapes, scaleVerified: !!o.measured }, config: { ...defaultConfig(), population: { ...defaultConfig().population, total: 0 } } };
    const v = validate(tmp);
    try { renderStaticPlan(root.querySelector('canvas'), rasterize(tmp), { pad: 6, labels: false }); } catch { /* preview only */ }
    const exits = r.shapes.filter((s) => s.type === 'exit');
    const people = Math.round(+o.people) || v.capacity.seats || Math.round(v.capacity.standing * CELL * CELL);
    const errs = v.issues.filter((i) => i.level !== 'info');
    btn.disabled = !exits.length;
    sum.innerHTML = `<div class="qb-stats">
        <div><b>${(r.W * r.D).toFixed(0)} m²</b><span>floor</span></div>
        <div><b>${v.capacity.seats}</b><span>seats</span></div>
        <div><b>${exits.length}</b><span>exits · ${(exits.length * r.ew).toFixed(1)} m clear</span></div>
        <div><b>${people}</b><span>people</span></div>
      </div>
      ${!exits.length ? `<p class="error-text">${icon('warning')}Add at least one emergency exit.</p>` : ''}
      ${r.rounded ? `<p class="faint">Rounded to the engine’s 0.5 m grid: room ${r.W} × ${r.D} m, exits ${r.ew} m wide.</p>` : ''}
      ${r.skipped.map((s) => `<p class="faint">Skipped: ${esc(s)}</p>`).join('')}
      ${errs.map((i) => `<p class="faint">${icon('warning')} ${esc(i.msg)}</p>`).join('')}
      ${venue.plan.shapes.length ? `<p class="faint">Replaces the ${venue.plan.shapes.length} element(s) currently on the blueprint (photos and plans are kept).</p>` : ''}`;
  };
  root.addEventListener('input', preview);
  root.addEventListener('change', preview);
  root.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
  root.querySelector('[data-build]').addEventListener('click', () => {
    preview();
    beforeApply?.();
    const res = applyQuickRoom(venue, o);
    venue.quick = JSON.parse(JSON.stringify(o));
    m.close();
    onBuilt?.(res);
  });
  requestAnimationFrame(preview);
  return m;
}
