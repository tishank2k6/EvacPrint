// Venue layout model.
// A layout is plain, serialisable data: a w×h grid of 0.5 m cells plus metadata.
// Everything else (simulation, 2D plan, 3D model, reports) is derived from it,
// so the same grid is the single source of truth for every view.

export const CELL = 0.5; // metres per cell side
export const CELL_AREA = CELL * CELL;

export const T = {
  VOID: 0, // outside the building
  FLOOR: 1,
  WALL: 2,
  SEAT: 3,
  OBST: 4, // furniture / equipment
  DOOR: 5, // internal opening (hall → corridor), flow-limited
  EXIT: 6, // final discharge to a stair or outside, flow-limited
  STAGE: 7,
};

export const TYPE_NAMES = ['Outside', 'Floor', 'Wall', 'Seat', 'Obstacle', 'Door', 'Exit', 'Stage'];

export const isOpening = (t) => t === T.DOOR || t === T.EXIT;

export function cloneLayout(l) {
  return {
    ...l,
    cells: new Uint8Array(l.cells),
    labels: { ...l.labels },
    blocked: [...l.blocked],
    meta: JSON.parse(JSON.stringify(l.meta)),
    modifications: [...(l.modifications || [])],
  };
}

export function serializeLayout(l) {
  let s = '';
  for (let i = 0; i < l.cells.length; i++) s += String.fromCharCode(48 + l.cells[i]);
  return { ...l, cells: s };
}

export function deserializeLayout(o) {
  const cells = new Uint8Array(o.cells.length);
  for (let i = 0; i < o.cells.length; i++) cells[i] = o.cells.charCodeAt(i) - 48;
  return { ...o, cells };
}

// ---------------------------------------------------------------------------
// Seminar Hall 406 — representative layout.
// 21 m × 15 m hall, 340 seats in 10 rows (3 blocks), stage, two rear doors,
// one side door, L-shaped corridor with three final exits.
// Dimensions are a planning model to be verified against on-site measurement.
// ---------------------------------------------------------------------------
export function createHall406() {
  const w = 52;
  const h = 39;
  const cells = new Uint8Array(w * h); // VOID
  const id = (x, y) => y * w + x;
  const rect = (x0, y0, x1, y1, t) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[id(x, y)] = t;
  };

  // Building shell
  rect(2, 2, 50, 37, T.WALL);
  // Hall interior
  rect(3, 3, 44, 32, T.FLOOR);
  // East corridor + south corridor
  rect(46, 3, 49, 36, T.FLOOR);
  rect(3, 34, 49, 36, T.FLOOR);

  // Stage (raised platform against the north wall)
  rect(9, 3, 38, 7, T.STAGE);

  // Seating: 10 rows, seat row at y, legroom row at y-1 (audience faces north)
  const blocks = [
    [5, 14],
    [17, 30],
    [33, 42],
  ];
  for (let r = 0; r < 10; r++) {
    const sy = 12 + r * 2;
    for (const [x0, x1] of blocks) rect(x0, sy, x1, sy, T.SEAT);
  }

  // AV console in the rear cross-aisle, beside the right centre aisle
  rect(33, 32, 35, 32, T.OBST);
  // Lectern on stage edge (decorative obstacle on the stage itself is irrelevant), skip.

  // Openings
  const labels = {};
  const opening = (cellsList, t, name) => {
    for (const [x, y] of cellsList) {
      cells[id(x, y)] = t;
      labels[id(x, y)] = name;
    }
  };
  opening([[8, 33], [9, 33]], T.DOOR, 'Door A');
  opening([[37, 33], [38, 33]], T.DOOR, 'Door B');
  opening([[45, 9], [45, 10]], T.DOOR, 'Door C');
  opening([[2, 34], [2, 35], [2, 36]], T.EXIT, 'West stair');
  opening([[46, 2], [47, 2], [48, 2], [49, 2]], T.EXIT, 'North fire stair');
  opening([[22, 37], [23, 37], [24, 37], [25, 37]], T.EXIT, 'Lobby exit');

  const wheelchairBays = [id(4, 31), id(12, 31), id(41, 31), id(44, 31)];

  return {
    name: 'Seminar Hall 406',
    w,
    h,
    cells,
    labels,
    blocked: [],
    modifications: [],
    meta: {
      hall: { x0: 3, y0: 3, x1: 44, y1: 32 },
      wheelchairBays,
      regions: [
        { name: 'Front cross-aisle', x0: 3, y0: 8, x1: 44, y1: 10 },
        { name: 'Rear cross-aisle', x0: 3, y0: 31, x1: 44, y1: 32 },
        { name: 'Left side aisle', x0: 3, y0: 11, x1: 4, y1: 30 },
        { name: 'Right side aisle', x0: 43, y0: 11, x1: 44, y1: 30 },
        { name: 'Left centre aisle', x0: 15, y0: 11, x1: 16, y1: 30 },
        { name: 'Right centre aisle', x0: 31, y0: 11, x1: 32, y1: 30 },
        { name: 'Left seating block', x0: 5, y0: 11, x1: 14, y1: 30 },
        { name: 'Centre seating block', x0: 17, y0: 11, x1: 30, y1: 30 },
        { name: 'Right seating block', x0: 33, y0: 11, x1: 42, y1: 30 },
        { name: 'South corridor', x0: 3, y0: 34, x1: 49, y1: 36 },
        { name: 'East corridor', x0: 46, y0: 3, x1: 49, y1: 33 },
        { name: 'Stage front', x0: 9, y0: 8, x1: 38, y1: 8 },
      ],
      // Layout-specific design changes the recommendation engine may test.
      designOptions: [
        {
          id: 'west-exit',
          kind: 'add-exit',
          title: 'Add a 1.0 m emergency exit on the west wall',
          detail: 'New outward-opening fire door beside the stage, discharging directly outside.',
          name: 'West emergency exit',
          cells: [id(2, 9), id(2, 10)],
          type: T.EXIT,
          requires: { [id(2, 9)]: T.WALL, [id(2, 10)]: T.WALL },
        },
        {
          id: 'move-av',
          kind: 'clear',
          title: 'Relocate the AV console out of the rear cross-aisle',
          detail: 'Frees 1.5 m of rear-aisle width on the approach to Door B.',
          cells: [id(33, 32), id(34, 32), id(35, 32)],
          from: T.OBST,
        },
        {
          id: 'centre-aisles',
          kind: 'clear',
          title: 'Widen both centre aisles from 1.0 m to 1.5 m',
          detail: 'Removes the inner seat of each centre-block row (−20 seats).',
          cells: Array.from({ length: 10 }, (_, r) => [id(17, 12 + r * 2), id(30, 12 + r * 2)]).flat(),
          from: T.SEAT,
        },
        {
          id: 'trim-stage',
          kind: 'clear',
          title: 'Shorten the stage by 1 m at each end',
          detail: 'Widens the front passages that lead to Door C and the west wall.',
          cells: [9, 10, 37, 38].flatMap((x) => [3, 4, 5, 6, 7].map((y) => id(x, y))),
          from: T.STAGE,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Opening groups (doors / exits) via 4-connected components
// ---------------------------------------------------------------------------
export function detectGroups(layout) {
  const { w, h, cells, labels } = layout;
  const seen = new Uint8Array(w * h);
  const groups = [];
  let autoDoor = 1;
  let autoExit = 1;
  for (let i = 0; i < cells.length; i++) {
    const t = cells[i];
    if (!isOpening(t) || seen[i]) continue;
    const stack = [i];
    const members = [];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      members.push(c);
      const x = c % w;
      const y = (c / w) | 0;
      const nb = [];
      if (x > 0) nb.push(c - 1);
      if (x < w - 1) nb.push(c + 1);
      if (y > 0) nb.push(c - w);
      if (y < h - 1) nb.push(c + w);
      for (const n of nb) if (!seen[n] && cells[n] === t) (seen[n] = 1), stack.push(n);
    }
    members.sort((a, b) => a - b);
    let name = null;
    for (const m of members) if (labels[m]) { name = labels[m]; break; }
    if (!name) name = t === T.DOOR ? `Door ${autoDoor++ + 3}` : `Exit ${autoExit++}`;
    const xs = members.map((m) => m % w);
    const ys = members.map((m) => (m / w) | 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const horizontal = maxX - minX >= maxY - minY;
    groups.push({
      id: groups.length,
      type: t === T.DOOR ? 'door' : 'exit',
      name,
      cells: members,
      widthM: (horizontal ? maxX - minX + 1 : maxY - minY + 1) * CELL,
      horizontal,
      bounds: { minX, maxX, minY, maxY },
      cx: ((minX + maxX + 1) / 2) * CELL,
      cy: ((minY + maxY + 1) / 2) * CELL,
      blocked: layout.blocked.includes(name),
    });
  }
  // Stable display order: doors first then exits, alphabetical
  return groups;
}

// ---------------------------------------------------------------------------
// Compile a layout into the arrays the engine needs.
// ---------------------------------------------------------------------------
export function compile(layout) {
  const { w, h, cells } = layout;
  const n = w * h;
  const groups = detectGroups(layout);
  const groupOf = new Int16Array(n).fill(-1);
  for (const g of groups) for (const c of g.cells) groupOf[c] = g.id;

  const passable = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = cells[i];
    if (t === T.FLOOR) passable[i] = 1;
    else if (isOpening(t)) passable[i] = groups[groupOf[i]].blocked ? 0 : 1;
  }

  // Restricted / hazard zones configured in Venue Studio close the cells they cover.
  for (const z of layout.meta?.hazards || []) if (z.blocks) for (const c of z.cells) passable[c] = 0;

  // Area (m²) of the 3×3 density window around each cell. Seats count as
  // occupiable area (a standing person in a row occupies seat + legroom).
  const area = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!passable[i]) continue;
      let a = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (passable[j] || cells[j] === T.SEAT) a += CELL_AREA;
        }
      area[i] = a;
    }

  const seats = [];
  for (let i = 0; i < n; i++) if (cells[i] === T.SEAT) seats.push(i);

  const exits = groups.filter((g) => g.type === 'exit' && !g.blocked);
  const doors = groups.filter((g) => g.type === 'door');

  // Cells where overflow (standing) occupants may be placed: circulation
  // floor inside the hall that is not a row's legroom, on a checkerboard so
  // the initial standing density stays ≤ 2 p/m².
  const hall = layout.meta.hall || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  const standCells = [];
  for (let y = hall.y0; y <= hall.y1; y++)
    for (let x = hall.x0; x <= hall.x1; x++) {
      const i = y * w + x;
      if (cells[i] !== T.FLOOR || (x + y) % 2) continue;
      const below = y + 1 < h ? cells[i + w] : T.VOID;
      if (below === T.SEAT) continue; // legroom row
      standCells.push(i);
    }

  return { w, h, n, cells, passable, area, groups, groupOf, exits, doors, seats, standCells, layout };
}

// ---------------------------------------------------------------------------
// Design modifications. Each returns a new layout or null if not applicable.
// ---------------------------------------------------------------------------
function withMod(layout, title) {
  const l = cloneLayout(layout);
  l.modifications.push(title);
  return l;
}

export function widenOpening(layout, groupName, addCells = 2) {
  const groups = detectGroups(layout);
  const g = groups.find((gg) => gg.name === groupName);
  if (!g || g.blocked) return null;
  const { w, h, cells } = layout;
  const next = new Uint8Array(cells);
  const t = g.type === 'door' ? T.DOOR : T.EXIT;
  let { minX, maxX, minY, maxY } = g.bounds;
  const ok = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    if (next[i] !== T.WALL) return false;
    // both sides of the wall must be usable (floor or, for exits, outside)
    const [a, b] = g.horizontal ? [i - w, i + w] : [i - 1, i + 1];
    const side = (j) => next[j] === T.FLOOR || next[j] === t || (t === T.EXIT && next[j] === T.VOID);
    return side(a) && side(b) && !(next[a] === T.VOID && next[b] === T.VOID);
  };
  let added = 0;
  let flip = 0;
  let guard = 0;
  while (added < addCells && guard++ < 20) {
    const tryHigh = flip++ % 2 === 0;
    const cand = g.horizontal
      ? tryHigh ? [maxX + 1, minY] : [minX - 1, minY]
      : tryHigh ? [minX, maxY + 1] : [minX, minY - 1];
    const alt = g.horizontal
      ? tryHigh ? [minX - 1, minY] : [maxX + 1, minY]
      : tryHigh ? [minX, minY - 1] : [minX, maxY + 1];
    let pick = ok(...cand) ? cand : ok(...alt) ? alt : null;
    if (!pick) break;
    next[pick[1] * w + pick[0]] = t;
    if (g.horizontal) { minX = Math.min(minX, pick[0]); maxX = Math.max(maxX, pick[0]); }
    else { minY = Math.min(minY, pick[1]); maxY = Math.max(maxY, pick[1]); }
    added++;
  }
  if (added < addCells) return null;
  const newW = g.widthM + added * CELL;
  const title = `Widen ${g.name} from ${g.widthM.toFixed(1)} m to ${newW.toFixed(1)} m`;
  const l = withMod(layout, title);
  l.cells = next;
  // propagate label to new cells
  for (let i = 0; i < next.length; i++) if (next[i] === t && cells[i] !== t) l.labels[i] = g.name;
  return l;
}

export function unblockOpening(layout, name) {
  if (!layout.blocked.includes(name)) return null;
  const l = withMod(layout, `Clear the obstruction at ${name}`);
  l.blocked = l.blocked.filter((b) => b !== name);
  return l;
}

export function applyDesignOption(layout, optId) {
  const opt = layout.meta.designOptions?.find((o) => o.id === optId);
  if (!opt) return null;
  if (opt.kind === 'add-exit') {
    if (!opt.cells.every((c) => layout.cells[c] === opt.requires[c])) return null;
    const l = withMod(layout, opt.title);
    for (const c of opt.cells) { l.cells[c] = opt.type; l.labels[c] = opt.name; }
    return l;
  }
  if (opt.kind === 'clear') {
    const present = opt.cells.filter((c) => layout.cells[c] === opt.from);
    if (present.length < opt.cells.length * 0.8) return null;
    const l = withMod(layout, opt.title);
    for (const c of present) l.cells[c] = T.FLOOR;
    return l;
  }
  return null;
}

export function removeRearRow(layout) {
  const { w, cells } = layout;
  const hall = layout.meta.hall;
  let rowY = -1;
  for (let y = hall.y1; y >= hall.y0 && rowY < 0; y--)
    for (let x = hall.x0; x <= hall.x1; x++) if (cells[y * w + x] === T.SEAT) { rowY = y; break; }
  if (rowY < 0) return null;
  let count = 0;
  for (let x = hall.x0; x <= hall.x1; x++) if (cells[rowY * w + x] === T.SEAT) count++;
  const l = withMod(layout, `Remove the rear seating row (−${count} seats)`);
  for (let x = hall.x0; x <= hall.x1; x++) if (l.cells[rowY * w + x] === T.SEAT) l.cells[rowY * w + x] = T.FLOOR;
  return l;
}

/** Every applicable design change for this layout, as {id, title, detail, layout}. */
export function generateCandidates(layout) {
  const out = [];
  const groups = detectGroups(layout);
  for (const g of groups) {
    if (g.blocked) {
      const l = unblockOpening(layout, g.name);
      if (l) out.push({ id: `unblock:${g.name}`, kind: 'unblock', title: l.modifications.at(-1), detail: `Restores ${g.name} (${g.widthM.toFixed(1)} m) to service.`, layout: l });
      continue;
    }
    const l = widenOpening(layout, g.name, 2);
    if (l) out.push({ id: `widen:${g.name}`, kind: 'widen', title: l.modifications.at(-1), detail: `Adds 1.0 m of clear width; door flow capacity rises with width (≈1.3 persons/s per metre).`, layout: l });
  }
  for (const opt of layout.meta.designOptions || []) {
    const l = applyDesignOption(layout, opt.id);
    if (l) out.push({ id: `opt:${opt.id}`, kind: opt.kind, title: opt.title, detail: opt.detail, layout: l });
  }
  const rr = removeRearRow(layout);
  if (rr) out.push({ id: 'remove-row', kind: 'clear', title: rr.modifications.at(-1), detail: 'Turns the last row into a wider cross-aisle feeding both rear doors.', layout: rr });
  return out;
}

/** Name of the region / landmark nearest to a point (metres). */
export function describeLocation(compiled, xm, ym) {
  const { layout, groups } = compiled;
  let best = null;
  let bestD = 2.5; // within 2.5 m of a door/exit → name it
  for (const g of groups) {
    const d = Math.hypot(g.cx - xm, g.cy - ym);
    if (d < bestD) { bestD = d; best = `${g.name} approach`; }
  }
  if (best) return best;
  const cx = Math.floor(xm / CELL), cy = Math.floor(ym / CELL);
  for (const r of layout.meta.regions || []) if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) return r.name;
  return `Grid ${xm.toFixed(1)} m, ${ym.toFixed(1)} m`;
}

// ---------------------------------------------------------------------------
// Extended design changes for custom venues (Venue Studio). Generated from the
// geometry alone; each one is re-simulated by the recommendation engine.
// ---------------------------------------------------------------------------
const TRADEOFF = {
  widen: 'Structural opening work and new door hardware; check the wall is not load-bearing.',
  unblock: 'Management change: keep this route clear of storage at all times.',
  'add-exit': 'New exit door, signage and a protected discharge route outside; may need structural approval.',
  'move-obstacle': 'The furniture needs a new home outside the escape route.',
  aisle: 'Fewer seats; check aisle widths against the local code.',
  access: 'Ramp or level threshold construction at this exit.',
  reopen: 'The restricted area must be made safe and available during an evacuation.',
};
export const tradeoffFor = (kind) => TRADEOFF[kind] || '';

export function generateExtraCandidates(layout) {
  const { w, h, cells } = layout;
  const c = compile(layout);
  const out = [];
  // 1. additional exit on the exterior wall farthest from existing exits
  const exitsXY = c.groups.filter((g) => g.type === 'exit').map((g) => [g.cx / CELL, g.cy / CELL]);
  let best = null;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (cells[i] !== T.WALL) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const a = cells[i - dx - dy * w], b = cells[i + dx + dy * w];
        const outsideA = a === T.VOID && b === T.FLOOR, outsideB = b === T.VOID && a === T.FLOOR;
        if (!outsideA && !outsideB) continue;
        // the next wall cell along the wall must be similar so a 1 m opening fits
        const along = dx ? w : 1;
        const j = i + along;
        if (cells[j] !== T.WALL || (cells[j - dx - dy * w] !== a) || (cells[j + dx + dy * w] !== b)) continue;
        const d = exitsXY.length ? Math.min(...exitsXY.map(([ex, ey]) => Math.hypot(ex - x, ey - y))) : 99;
        if (!best || d > best.d) best = { i, j, d, side: dx ? (outsideA ? 'west' : 'east') : (outsideA ? 'north' : 'south') };
      }
    }
  if (best && best.d > 8) {
    const l = cloneLayout(layout);
    const name = `New ${best.side} exit`;
    for (const k of [best.i, best.j]) { l.cells[k] = T.EXIT; l.labels[k] = name; }
    const title = `Add a 1.0 m emergency exit on the ${best.side} wall (${((best.i % w) * CELL).toFixed(0)} m, ${(Math.floor(best.i / w) * CELL).toFixed(0)} m)`;
    l.modifications.push(title);
    out.push({ id: 'x:add-exit', kind: 'add-exit', title, detail: 'Placed on the exterior wall farthest from the existing exits.', layout: l });
  }
  // 2. move obstacles that sit near openings
  const seen = new Uint8Array(w * h);
  let moved = 0;
  for (let i = 0; i < w * h && moved < 2; i++) {
    if (cells[i] !== T.OBST || seen[i]) continue;
    const comp = [];
    const st = [i]; seen[i] = 1;
    while (st.length) { const q = st.pop(); comp.push(q); for (const d of [1, -1, w, -w]) { const j = q + d; if (cells[j] === T.OBST && !seen[j]) { seen[j] = 1; st.push(j); } } }
    const cx = (comp.reduce((s, q) => s + (q % w), 0) / comp.length + 0.5) * CELL, cy = (comp.reduce((s, q) => s + Math.floor(q / w), 0) / comp.length + 0.5) * CELL;
    const near = c.groups.some((g) => Math.hypot(g.cx - cx, g.cy - cy) < 4);
    if (!near) continue;
    const l = cloneLayout(layout);
    for (const q of comp) l.cells[q] = T.FLOOR;
    const where = describeLocation(c, cx, cy);
    const title = `Move the furniture/obstacle at ${where} out of the escape route`;
    l.modifications.push(title);
    out.push({ id: `x:move-${i}`, kind: 'move-obstacle', title, detail: `${(comp.length * CELL * CELL).toFixed(1)} m² of obstruction within 4 m of an opening.`, layout: l });
    moved++;
  }
  // 3. add an aisle through the longest seat row run
  let run = null;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (cells[y * w + x] !== T.SEAT) { x++; continue; }
      let x1 = x;
      while (x1 + 1 < w && cells[y * w + x1 + 1] === T.SEAT) x1++;
      if (!run || x1 - x > run.len) run = { y, x0: x, x1, len: x1 - x };
      x = x1 + 1;
    }
  }
  if (run && run.len + 1 >= 14) {
    const mid = Math.floor((run.x0 + run.x1) / 2);
    const l = cloneLayout(layout);
    let lost = 0;
    for (let y = 0; y < h; y++) for (const x of [mid, mid + 1]) { const i = y * w + x; if (l.cells[i] === T.SEAT && x >= run.x0 && x <= run.x1) { l.cells[i] = T.FLOOR; lost++; } }
    const title = `Add a 1.0 m aisle through the ${run.len + 1}-seat rows (−${lost} seats)`;
    l.modifications.push(title);
    out.push({ id: 'x:aisle', kind: 'aisle', title, detail: 'Shortens the distance occupants shuffle along a row before reaching an aisle.', layout: l, seatsLost: lost });
  }
  // 4. accessibility: make inaccessible exits step-free
  for (const [name, p] of Object.entries(layout.meta?.exitProps || {})) {
    if (p.accessible !== false) continue;
    const l = cloneLayout(layout);
    l.meta.exitProps[name] = { ...p, accessible: true };
    const title = `Make ${name} step-free for wheelchair users`;
    l.modifications.push(title);
    out.push({ id: `x:access-${name}`, kind: 'access', title, detail: 'Adds a ramp or level threshold so wheelchair users may use this exit.', layout: l });
  }
  // 5. route availability: re-open restricted (non-hazard) zones
  (layout.meta?.hazards || []).forEach((z, k) => {
    if (z.kind !== 'restricted') return;
    const l = cloneLayout(layout);
    l.meta.hazards = l.meta.hazards.filter((_, q) => q !== k);
    const title = `Re-open the restricted area "${z.label}" during evacuations`;
    l.modifications.push(title);
    out.push({ id: `x:reopen-${k}`, kind: 'reopen', title, detail: 'Makes the area available as an escape route.', layout: l });
  });
  return out;
}
