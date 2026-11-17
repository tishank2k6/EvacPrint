// Venue Studio data model.
// A venue is stored as editable vector shapes in metres. `rasterize()` turns
// it into the same 0.5 m layout grid the existing engine, 2D plan, 3D view,
// recommendation engine and reports already use — there is no second
// simulator. `toSimulation()` maps the wizard configuration onto engine
// parameters (population profiles, spawn areas, exit properties, zones).
import { CELL, T, compile } from '../sim/layout.js';
import { distanceField } from '../sim/pathfinding.js';

export const M = 2; // void margin in cells around the plan

export const SHAPE_TYPES = {
  room: { label: 'Room', kind: 'rect', icon: 'plan', w: 12, h: 9 },
  corridor: { label: 'Corridor', kind: 'rect', icon: 'arrows', w: 10, h: 2 },
  wall: { label: 'Wall', kind: 'line', icon: 'edit' },
  door: { label: 'Door', kind: 'opening', icon: 'door', width: 1 },
  exit: { label: 'Emergency exit', kind: 'opening', icon: 'exit', width: 1.5 },
  stairs: { label: 'Stairs', kind: 'rect', icon: 'layers', w: 2, h: 4 },
  ramp: { label: 'Ramp', kind: 'rect', icon: 'route', w: 1.5, h: 5 },
  seating: { label: 'Seating block', kind: 'rect', icon: 'grid', w: 6, h: 6 },
  chair: { label: 'Chair', kind: 'rect', icon: 'users', w: 0.5, h: 0.5 },
  stage: { label: 'Stage', kind: 'rect', icon: 'building', w: 8, h: 3 },
  furniture: { label: 'Furniture', kind: 'rect', icon: 'report', w: 1.5, h: 0.8 },
  pillar: { label: 'Pillar', kind: 'rect', icon: 'target', w: 0.5, h: 0.5 },
  obstacle: { label: 'Obstacle', kind: 'rect', icon: 'warning', w: 1, h: 1 },
  zone: { label: 'Hazard / restricted zone', kind: 'rect', icon: 'heat', w: 3, h: 3 },
  floorplate: { label: 'Enclosed floor area', kind: 'rect', icon: 'overview', w: 20, h: 14 },
};

export const ZONE_KINDS = {
  restricted: { label: 'Restricted (closed to occupants)', blocks: true, mult: null },
  fire: { label: 'Fire seat (impassable)', blocks: true, mult: null },
  debris: { label: 'Debris / structural damage (impassable)', blocks: true, mult: null },
  smoke: { label: 'Smoke (reduced visibility)', blocks: false, mult: [0.6, 0.5, 0.5] },
  water: { label: 'Standing water (ankle depth)', blocks: false, mult: [0.7, 0.55, 0.4] },
};

let seq = 0;
export const uid = (p = 's') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newShape(type, x, y, extra = {}) {
  const def = SHAPE_TYPES[type];
  const s = { id: uid(), type, rot: 0, name: '' };
  if (def.kind === 'line') Object.assign(s, { x1: x, y1: y, x2: x + 4, y2: y });
  else if (def.kind === 'opening') Object.assign(s, { x, y, width: def.width, rot: 0 });
  else Object.assign(s, { x, y, w: def.w, h: def.h });
  if (type === 'zone') s.kind = 'restricted';
  if (type === 'seating') s.pitch = 1.0;
  return Object.assign(s, extra);
}

/** rectangle after 90° rotations (rot ∈ 0,90,180,270), rotated about its centre */
export function rectOf(s) {
  const swap = s.rot % 180 !== 0;
  const w = swap ? s.h : s.w, h = swap ? s.w : s.h;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// ---------------------------------------------------------------------- defaults
export function defaultConfig() {
  return {
    mode: 'beginner',
    details: { name: '', buildingType: 'Educational', category: 'Auditorium / seminar hall', floor: 1, totalFloors: 1, indoor: true, normalOcc: 120, maxOcc: 200 },
    dimensions: { ceiling: 3.5, stairWidth: 1.5, rampWidth: 1.5 },
    population: { total: 120, seats: 80, standing: 10, corridors: 5, entrances: 5, rooms: {} },
    age: { unit: 'percent', children: 0, teens: 5, adults: 85, seniors: 10 },
    mobility: { wheelchair: 1, walkingAid: 1, injured: 0, reduced: 3, visual: 0, hearing: 0, assisted: 0, caregivers: 0 },
    behaviour: { familiarPct: 60, staff: 2, security: 1, groupPct: 0 },
    emergency: { type: 'general', notes: '' },
    exits: {},
    environment: { lighting: 'normal', emergencyLighting: true, visibility: 'good', signage: 'good', alarm: 'automatic', floor: 'dry', detectionDelay: 0, alarmDelay: 5, preMin: 10, preMax: 30, staffResponse: 30 },
    sim: { runs: 3, seed: 406, maxTime: 600, panic: 0.2, doorFlow: 1.33, scenario: 'Baseline' },
  };
}

export function newVenue(name = 'Untitled venue') {
  const v = {
    id: uid('v'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: { method: 'manual', media: [] },
    plan: { width: 30, height: 20, shapes: [], background: null, scaleVerified: false, unverified: [] },
    config: defaultConfig(),
    scenarios: [],
    runs: [],
  };
  v.config.details.name = name;
  return v;
}

/** A small ready-made venue so the editor never starts empty when asked for a template. */
export function templateHall() {
  const v = newVenue('Lecture room template');
  v.plan.width = 26; v.plan.height = 18;
  v.plan.shapes = [
    newShape('room', 2, 2, { w: 16, h: 12, name: 'Lecture room' }),
    newShape('corridor', 2, 14, { w: 22, h: 2.5, name: 'Corridor' }),
    newShape('stage', 5, 2.5, { w: 10, h: 2 }),
    newShape('seating', 3, 6, { w: 6, h: 7, name: 'Left seats' }),
    newShape('seating', 11, 6, { w: 6, h: 7, name: 'Right seats' }),
    newShape('door', 4, 14, { width: 1, name: 'Door 1' }),
    newShape('door', 15, 14, { width: 1, name: 'Door 2' }),
    newShape('exit', 24, 15.25, { width: 1.5, rot: 90, name: 'Main exit' }),
    newShape('exit', 2, 15.25, { width: 1.5, rot: 90, name: 'Side exit' }),
  ];
  v.config.exits = { 'Main exit': { main: true } };
  return v;
}

// ---------------------------------------------------------------------- rasterisation
export function rasterize(venue) {
  const { plan } = venue;
  const w = Math.ceil(plan.width / CELL) + 2 * M;
  const h = Math.ceil(plan.height / CELL) + 2 * M;
  const n = w * h;
  const cells = new Uint8Array(n); // VOID
  const labels = {};
  const at = (xm, ym) => {
    const x = Math.floor(xm / CELL + 1e-6) + M, y = Math.floor(ym / CELL + 1e-6) + M;
    return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
  };
  const rectCells = (r, inset = 0, inclusive = false) => {
    const out = [];
    const x0 = Math.round(r.x / CELL) + M + inset, y0 = Math.round(r.y / CELL) + M + inset;
    const e = inclusive ? 0 : 1;
    const x1 = Math.round((r.x + r.w) / CELL) + M - e - inset, y1 = Math.round((r.y + r.h) / CELL) + M - e - inset;
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) out.push(y * w + x);
    return { out, x0, y0, x1, y1 };
  };
  const S = plan.shapes;
  const areas = S.filter((s) => s.type === 'room' || s.type === 'corridor' || s.type === 'stairs' || s.type === 'ramp');
  const interior = new Uint8Array(n);
  const perimeter = [];
  const regions = [];
  for (const s of areas) {
    const r = rectOf(s);
    const walled = s.type === 'room' || s.type === 'corridor';
    const all = rectCells(r, 0, walled);
    const inner = rectCells(r, walled ? 1 : 0, walled);
    for (const c of inner.out) interior[c] = 1;
    if (walled) { const ins = new Set(inner.out); for (const c of all.out) if (!ins.has(c)) perimeter.push(c); }
    regions.push({ name: s.name || SHAPE_TYPES[s.type].label, x0: inner.x0, y0: inner.y0, x1: inner.x1, y1: inner.y1, type: s.type, id: s.id });
  }
  for (let i = 0; i < n; i++) if (interior[i]) cells[i] = T.FLOOR;
  for (const c of perimeter) if (!interior[c]) cells[c] = T.WALL;
  // free-standing walls
  for (const s of S.filter((q) => q.type === 'wall')) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.4)));
    for (let k = 0; k <= steps; k++) { const c = at(s.x1 + ((s.x2 - s.x1) * k) / steps, s.y1 + ((s.y2 - s.y1) * k) / steps); if (c >= 0) cells[c] = T.WALL; }
  }
  // enclosed floor areas (traced / imported plans): floor = space the walls enclose.
  // Walls are dilated by two cells for the fill only, so drawn door gaps up to
  // 2 m don't leak; the outside is then grown back over that two-cell band so
  // no floor appears outside the outer walls.
  for (const s of S.filter((q) => q.type === 'floorplate')) {
    const r = rectOf(s);
    const x0 = Math.max(0, Math.round(r.x / CELL) + M), y0 = Math.max(0, Math.round(r.y / CELL) + M);
    const x1 = Math.min(w - 1, Math.round((r.x + r.w) / CELL) + M), y1 = Math.min(h - 1, Math.round((r.y + r.h) / CELL) + M);
    const D = 2;
    const blocked = (x, y) => { for (let dy = -D; dy <= D; dy++) for (let dx = -D; dx <= D; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && cells[yy * w + xx] === T.WALL) return true; } return false; };
    const inR = (x, y) => x >= x0 && y >= y0 && x <= x1 && y <= y1;
    const out = new Uint8Array(n);
    const stack = [];
    // the area's border ring is outside by definition (even when close to a wall)
    const seed = (x, y) => { const i = y * w + x; if (cells[i] !== T.WALL && !out[i]) { out[i] = 1; stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); } };
    for (let x = x0; x <= x1; x++) { seed(x, y0); seed(x, y1); }
    for (let y = y0; y <= y1; y++) { seed(x0, y); seed(x1, y); }
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!inR(x, y)) continue;
      const i = y * w + x;
      if (out[i] || blocked(x, y)) continue;
      out[i] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    // grow the outside back over the dilation band (never through a wall cell)
    let front = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (out[y * w + x]) front.push([x, y]);
    for (let step = 0; step < D; step++) {
      const nextF = [];
      for (const [x, y] of front)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (!inR(xx, yy)) continue;
          const j = yy * w + xx;
          if (out[j] || cells[j] === T.WALL) continue;
          out[j] = 1;
          nextF.push([xx, yy]);
        }
      front = nextF;
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (!out[i] && cells[i] === T.VOID) cells[i] = T.FLOOR; }
    regions.push({ name: s.name || 'Floor area', x0, y0, x1, y1, type: 'room', id: s.id });
  }

  const speedZones = [];
  const hazards = [];
  for (const s of S) {
    const r = s.w != null ? rectOf(s) : null;
    if (s.type === 'stairs') speedZones.push({ cells: rectCells(r).out, mult: [0.6, 0.45, 0.12], label: s.name || 'Stairs' });
    if (s.type === 'ramp') speedZones.push({ cells: rectCells(r).out, mult: [0.9, 0.85, 0.75], label: s.name || 'Ramp' });
    if (s.type === 'stage') for (const c of rectCells(r).out) if (cells[c] === T.FLOOR) cells[c] = T.STAGE;
    if (s.type === 'furniture' || s.type === 'obstacle') for (const c of rectCells(r).out) if (cells[c] === T.FLOOR) cells[c] = T.OBST;
    if (s.type === 'pillar') for (const c of rectCells(r).out) cells[c] = T.WALL;
    if (s.type === 'chair') { const c = at(s.x + 0.25, s.y + 0.25); if (c >= 0 && cells[c] === T.FLOOR) cells[c] = T.SEAT; }
    if (s.type === 'seating') {
      const { x0, y0, x1, y1 } = rectCells(r);
      const pitch = Math.max(2, Math.round((s.pitch || 1) / CELL));
      const vertical = s.rot % 180 !== 0;
      const flip = s.rot === 180 || s.rot === 270;
      if (!vertical) {
        // rows run east–west; audience faces north (rot 0) or south (rot 180)
        for (let y = flip ? y0 : y1; flip ? y <= y1 : y >= y0; y += flip ? pitch : -pitch)
          for (let x = x0; x <= x1; x++) { const c = y * w + x; if (cells[c] === T.FLOOR) cells[c] = T.SEAT; }
      } else {
        for (let x = flip ? x0 : x1; flip ? x <= x1 : x >= x0; x += flip ? pitch : -pitch)
          for (let y = y0; y <= y1; y++) { const c = y * w + x; if (cells[c] === T.FLOOR) cells[c] = T.SEAT; }
      }
    }
    if (s.type === 'zone') {
      const k = ZONE_KINDS[s.kind] || ZONE_KINDS.restricted;
      const cs = rectCells(r).out.filter((c) => cells[c] === T.FLOOR || cells[c] === T.SEAT);
      if (k.blocks) hazards.push({ cells: cs, blocks: true, kind: s.kind, label: s.name || k.label, id: s.id });
      else speedZones.push({ cells: cs, mult: k.mult, label: s.name || k.label, hazard: true });
    }
  }
  // openings last, so they cut through walls
  const used = new Set(S.map((q) => q.name).filter(Boolean));
  const nextName = (base) => { let k = 1; while (used.has(`${base} ${k}`)) k++; used.add(`${base} ${k}`); return `${base} ${k}`; };
  for (const s of S.filter((q) => q.type === 'door' || q.type === 'exit')) {
    if (!s.name) s.name = nextName(s.type === 'door' ? 'Door' : 'Exit');
    const horizontal = s.rot % 180 === 0;
    const k = Math.max(1, Math.round(s.width / CELL));
    const c0 = at(s.x, s.y);
    if (c0 < 0) continue;
    const cx = c0 % w, cy = (c0 / w) | 0;
    for (let j = 0; j < k; j++) {
      const x = horizontal ? cx + j : cx, y = horizontal ? cy : cy + j;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const c = y * w + x;
      cells[c] = s.type === 'door' ? T.DOOR : T.EXIT;
      labels[c] = s.name;
    }
  }
  // hall = rooms holding seating, else the largest room
  const rooms = regions.filter((r) => r.type === 'room');
  let hall = null;
  for (const r of rooms) {
    let seats = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (cells[y * w + x] === T.SEAT) seats++;
    if (seats && (!hall || seats > hall.seats)) hall = { ...r, seats };
  }
  if (!hall && rooms.length) hall = rooms.slice().sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0];
  const cfgExits = venue.config.exits || {};
  const exitProps = {};
  const blocked = [];
  for (const s of S.filter((q) => q.type === 'door' || q.type === 'exit')) {
    const e = cfgExits[s.name] || {};
    exitProps[s.name] = { accessible: e.accessible !== false, flow: e.flow || (e.type === 'stair' ? 1.1 : venue.config.sim.doorFlow || 1.33), type: e.type || (s.type === 'exit' ? 'door' : 'internal') };
    if (e.open === false) blocked.push(s.name);
  }
  const main = Object.entries(cfgExits).find(([, e]) => e.main)?.[0] || S.find((q) => q.type === 'exit')?.name || null;
  return {
    name: venue.name,
    w, h, cells, labels, blocked, modifications: [],
    meta: {
      custom: true,
      venueId: venue.id,
      hall: hall ? { x0: hall.x0, y0: hall.y0, x1: hall.x1, y1: hall.y1 } : { x0: M, y0: M, x1: w - M - 1, y1: h - M - 1 },
      regions: regions.map(({ name, x0, y0, x1, y1 }) => ({ name, x0, y0, x1, y1 })),
      areaShapes: regions,
      designOptions: [],
      wheelchairBays: [],
      exitProps,
      mainEntrance: main,
      speedZones,
      hazards,
    },
  };
}

// ---------------------------------------------------------------------- validation
export function validate(venue, layout = rasterize(venue)) {
  const issues = [];
  const c = compile(layout);
  const exits = c.groups.filter((g) => g.type === 'exit');
  if (!venue.plan.shapes.some((s) => s.type === 'room' || s.type === 'corridor' || s.type === 'floorplate')) issues.push({ level: 'error', msg: 'Add at least one room or corridor.' });
  if (!exits.length) issues.push({ level: 'error', msg: 'Add at least one emergency exit on an outer wall.' });
  if (exits.length && !exits.some((g) => !g.blocked)) issues.push({ level: 'error', msg: 'Every exit is closed — open at least one.' });
  // openings must connect walkable space
  const OBSTRUCTING = new Set(['furniture', 'obstacle', 'pillar', 'seating', 'chair', 'stage', 'zone']);
  /** name of the drawn element that occupies grid cell i, if any (to explain a blocked opening) */
  const occupant = (i) => {
    const xm = ((i % c.w) - M + 0.5) * CELL, ym = (Math.floor(i / c.w) - M + 0.5) * CELL;
    const s = venue.plan.shapes.find((sh) => OBSTRUCTING.has(sh.type) && (() => { const r = rectOf(sh); return xm >= r.x && xm <= r.x + r.w && ym >= r.y && ym <= r.y + r.h; })());
    return s ? s.name || SHAPE_TYPES[s.type].label.toLowerCase() : null;
  };
  for (const g of c.groups) {
    const { minX, maxX, minY, maxY } = g.bounds;
    const sides = g.horizontal ? [(minY - 1) * c.w + minX, (maxY + 1) * c.w + minX] : [minY * c.w + minX - 1, minY * c.w + maxX + 1];
    const isOpen = (s) => c.cells[s] === T.FLOOR || c.cells[s] === T.DOOR || c.cells[s] === T.EXIT;
    const ok = sides.filter(isOpen).length;
    const by = sides.filter((s) => !isOpen(s)).map(occupant).find(Boolean);
    if (g.type === 'door' && ok < 2) issues.push({ level: 'warn', msg: by ? `${g.name} is blocked on one side by ${by} — move it clear of the doorway.` : `${g.name} does not connect two spaces — place it on a wall between them.` });
    if (g.type === 'exit' && ok < 1) issues.push({ level: 'warn', msg: by ? `${g.name} is blocked from inside by ${by} — move it clear of the exit.` : `${g.name} is not reachable from inside — place it on an outer wall.` });
  }
  // reachability
  const open = exits.filter((g) => !g.blocked).flatMap((g) => g.cells);
  if (open.length) {
    const f = distanceField(c, open, null, null);
    let unreachable = 0;
    for (let i = 0; i < c.n; i++) if ((c.cells[i] === T.FLOOR) && c.passable[i] && !isFinite(f[i])) unreachable++;
    if (unreachable) issues.push({ level: 'warn', msg: `${(unreachable * CELL * CELL).toFixed(1)} m² of floor has no route to an open exit.` });
  }
  const cap = c.seats.length + c.standCells.length;
  const total = venue.config.population.total;
  if (total > cap * 1.6) issues.push({ level: 'warn', msg: `${total} people may not fit: about ${cap} seat/standing spots at ≤ 2 p/m².` });
  if (!venue.plan.scaleVerified) issues.push({ level: 'info', msg: 'Dimensions are not verified against on-site measurement — results are planning estimates.' });
  return { issues, compiled: c, capacity: { seats: c.seats.length, standing: c.standCells.length } };
}

// ---------------------------------------------------------------------- configuration → engine
const LIGHT = { normal: 1, dim: 0.9, dark: 0.6 };
const VIS = { good: 1, reduced: 0.85, poor: 0.65 };
const FLOOR = { dry: 1, wet: 0.9, debris: 0.8 };
const SIGN = { good: 4, partial: 10, none: 18 };

export const ASSUMPTIONS = [
  'Lighting, visibility and floor condition scale walking speed (dark without emergency lighting ×0.6, poor visibility ×0.65, wet floor ×0.9). These factors are planning assumptions, not validated measurements.',
  'Occupants unfamiliar with the venue prefer the main entrance; the preference weakens with better exit signage (route-cost penalty of 4–18 m).',
  'Hearing-impaired occupants react later unless a visual alarm is fitted (+20 s assumption). Visually impaired and assisted occupants walk more slowly.',
  'Caregivers move at the pace of the person they assist; pairs are not kept spatially together.',
  'Stairs are modelled as slow floor (×0.6 adults, ×0.12 wheelchair users, i.e. an assisted carry). Separate floors are not modelled.',
  'Smoke and water zones only slow walking; fire spread, toxicity, structural collapse and water flow are not simulated.',
];

export function buildProfiles(cfg) {
  const total = Math.max(1, Math.round(cfg.population.total));
  const mob = cfg.mobility;
  const beh = cfg.behaviour;
  const env = cfg.environment;
  const hearAdd = env.alarm === 'voice-visual' ? 0 : 20;
  const special = [
    { label: 'Wheelchair users', n: mob.wheelchair, cat: 2, vMin: 0.7, vMax: 1.0, radius: 0.36, reactMul: 1.15 },
    { label: 'Walking aids', n: mob.walkingAid, cat: 1, vMin: 0.45, vMax: 0.75, radius: 0.26, reactMul: 1.2 },
    { label: 'Temporary injury', n: mob.injured, cat: 1, vMin: 0.55, vMax: 0.9, radius: 0.24, reactMul: 1.1 },
    { label: 'Reduced mobility', n: mob.reduced, cat: 1, vMin: 0.7, vMax: 1.0, radius: 0.23, reactMul: 1.15 },
    { label: 'Visually impaired', n: mob.visual, cat: 1, vMin: 0.55, vMax: 0.9, radius: 0.23, reactMul: 1.25 },
    { label: 'Hearing impaired', n: mob.hearing, cat: 0, vMin: 1.0, vMax: 1.5, radius: 0.22, reactMul: 1, reactAdd: hearAdd },
    { label: 'Needs assistance', n: mob.assisted, cat: 1, vMin: 0.4, vMax: 0.7, radius: 0.25, reactMul: 1.3 },
    { label: 'Caregivers', n: mob.caregivers, cat: 0, vMin: 0.4, vMax: 0.7, radius: 0.22, reactMul: 1.3, familiar: 0.5 },
    { label: 'Staff', n: beh.staff, cat: 0, vMin: 1.1, vMax: 1.5, radius: 0.22, reactMul: 0.5, familiar: 1 },
    { label: 'Security', n: beh.security, cat: 0, vMin: 1.2, vMax: 1.6, radius: 0.22, reactMul: 0.4, familiar: 1 },
  ].filter((p) => p.n > 0);
  const used = special.reduce((s, p) => s + p.n, 0);
  const rest = Math.max(0, total - used);
  const a = cfg.age;
  const ages = [
    { label: 'Children (0–12)', v: a.children, cat: 0, vMin: 0.9, vMax: 1.25, radius: 0.18, reactMul: 1.1 },
    { label: 'Teenagers (13–17)', v: a.teens, cat: 0, vMin: 1.1, vMax: 1.5, radius: 0.21, reactMul: 1 },
    { label: 'Adults (18–59)', v: a.adults, cat: 0, vMin: null, vMax: null, radius: 0.22, reactMul: 1 },
    { label: 'Seniors (60+)', v: a.seniors, cat: 1, vMin: 0.75, vMax: 1.05, radius: 0.23, reactMul: 1.2 },
  ];
  const ageTot = ages.reduce((s, g) => s + (+g.v || 0), 0) || 1;
  const fam = (beh.familiarPct ?? 60) / 100;
  const general = ages.map((g) => ({ ...g, n: a.unit === 'count' ? Math.min(rest, +g.v || 0) : Math.round(((+g.v || 0) / ageTot) * rest), familiar: fam }));
  const gsum = general.reduce((s, g) => s + g.n, 0);
  if (gsum !== rest && general.length) general[2].n = Math.max(0, general[2].n + (rest - gsum));
  return [...special, ...general].filter((p) => p.n > 0).map((p, id) => ({ ...p, id, share: p.n }));
}

export function spawnAreas(layout, cfg) {
  const c = compile(layout);
  const { w, cells } = c;
  const pop = cfg.population;
  const total = Math.max(1, Math.round(pop.total));
  const shares = { seats: +pop.seats || 0, standing: +pop.standing || 0, corridors: +pop.corridors || 0, entrances: +pop.entrances || 0 };
  const sum = Object.values(shares).reduce((s, v) => s + v, 0) || 1;
  const count = (k) => Math.round((shares[k] / sum) * total);
  const areaShapes = layout.meta.areaShapes || [];
  const inR = (r, i) => { const x = i % w, y = (i / w) | 0; return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; };
  const rooms = areaShapes.filter((r) => r.type === 'room');
  const weights = rooms.map((r) => pop.rooms?.[r.name] ?? 1);
  const wsum = weights.reduce((s, v) => s + v, 0) || 1;
  const areas = [];
  rooms.forEach((r, k) => {
    const seats = c.seats.filter((i) => inR(r, i));
    const stand = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const i = y * w + x; if (cells[i] === T.FLOOR && (x + y) % 2 === 0 && cells[i + w] !== T.SEAT) stand.push(i); }
    areas.push({ cells: seats, seated: true, count: Math.round((count('seats') * weights[k]) / wsum), room: r.name });
    areas.push({ cells: stand, seated: false, count: Math.round((count('standing') * weights[k]) / wsum), room: r.name });
  });
  const corr = [];
  for (const r of areaShapes.filter((q) => q.type === 'corridor')) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const i = y * w + x; if (cells[i] === T.FLOOR && (x + y) % 2 === 0) corr.push(i); }
  areas.push({ cells: corr, seated: false, count: count('corridors'), room: 'Corridors' });
  const ent = [];
  for (let i = 0; i < c.n; i++) {
    if (cells[i] !== T.FLOOR || !c.passable[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if ((x + y) % 2) continue;
    if (c.groups.some((g) => Math.hypot(g.cx - (x + 0.5) * CELL, g.cy - (y + 0.5) * CELL) < 3)) ent.push(i);
  }
  areas.push({ cells: ent, seated: false, count: count('entrances'), room: 'Near entrances' });
  // Never place people where no route reaches an open exit (sealed pockets,
  // areas cut off by closed doors or hazard zones). Seats count as reachable
  // when an adjacent walkable cell is.
  const open = c.exits.flatMap((g) => g.cells);
  if (open.length) {
    const f = distanceField(c, open, null, null);
    const ok = (i) => (cells[i] === T.SEAT ? [1, -1, w, -w].some((d) => isFinite(f[i + d])) : isFinite(f[i]));
    for (const a of areas) a.cells = a.cells.filter(ok);
  }
  return areas;
}

/** Venue + configuration → { layout, params } for the existing engine. */
export function toSimulation(venue, overrides = {}) {
  const cfg = venue.config;
  const layout = rasterize(venue);
  const env = cfg.environment;
  const light = env.lighting === 'dark' && env.emergencyLighting ? 0.85 : LIGHT[env.lighting] ?? 1;
  const speedFactor = Math.round(light * (VIS[env.visibility] ?? 1) * (FLOOR[env.floor] ?? 1) * 1000) / 1000;
  const params = {
    occupants: Math.round(cfg.population.total),
    slowFraction: 0,
    wheelchairs: 0,
    reactionMin: +env.preMin,
    reactionMax: Math.max(+env.preMin, +env.preMax),
    reactionAdd: (+env.detectionDelay || 0) + (env.alarm === 'none' ? 60 : +env.alarmDelay || 0),
    speedFactor,
    unfamiliarPenalty: SIGN[env.signage] ?? 10,
    panic: cfg.emergency.type === 'surge' ? Math.max(0.7, +cfg.sim.panic) : +cfg.sim.panic,
    seed: +cfg.sim.seed || 406,
    maxTime: +cfg.sim.maxTime || 600,
    profiles: buildProfiles(cfg),
    spawn: { custom: spawnAreas(layout, cfg).map(({ cells, seated, count }) => ({ cells, seated, count })) },
    ...overrides,
  };
  return { layout, params };
}

export const EMERGENCIES = {
  general: { label: 'General emergency', sim: ['Alarm, reaction and walking to exits'], notSim: [] },
  fire: { label: 'Fire', sim: ['Fire-seat zones close the area they cover', 'Smoke zones slow walking', 'Exits you close are avoided'], notSim: ['Fire spread over time', 'Heat and toxic gas (ASET)'] },
  smoke: { label: 'Smoke', sim: ['Smoke zones slow walking', 'Reduced visibility slows everyone'], notSim: ['Smoke movement and layering', 'Toxicity'] },
  earthquake: { label: 'Earthquake', sim: ['Debris zones close areas', 'Closed exits', 'Detection / alarm delay'], notSim: ['Ground shaking', 'Structural collapse dynamics', 'Aftershocks'] },
  flooding: { label: 'Flooding', sim: ['Water zones slow walking', 'Closed exits'], notSim: ['Rising water and flow'] },
  gas: { label: 'Gas leak', sim: ['Restricted zones', 'Alarm delay'], notSim: ['Gas dispersion', 'Exposure effects'] },
  electrical: { label: 'Electrical hazard', sim: ['Lighting failure slows walking', 'Restricted zones'], notSim: ['Electrical faults'] },
  structural: { label: 'Structural damage', sim: ['Debris / restricted zones', 'Closed exits'], notSim: ['Progressive collapse'] },
  chemical: { label: 'Chemical incident', sim: ['Restricted zones', 'Closed exits'], notSim: ['Chemical plume', 'Exposure'] },
  surge: { label: 'Crowd surge', sim: ['High panic: faster walking, door clogging (faster-is-slower)'], notSim: ['Crowd crush forces'] },
  security: { label: 'Security evacuation', sim: ['Exits you close are avoided', 'Restricted zones'], notSim: ['Threat behaviour'] },
  custom: { label: 'Custom scenario', sim: ['Any combination of zones, closed exits and delays'], notSim: [] },
};

export { CELL };
