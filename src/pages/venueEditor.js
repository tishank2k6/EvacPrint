import { icon } from '../ui/icons.js';
import { esc, toast, openModal, fmtSec, syncRange } from '../ui/dom.js';
import { getVenue, saveVenue, getMedia, duplicateVenue } from '../venue/store.js';
import { SHAPE_TYPES, ZONE_KINDS, rectOf, rasterize, validate, toSimulation, ASSUMPTIONS, EMERGENCIES, uid } from '../venue/model.js';
import { BlueprintEditor } from '../venue/editor.js';
import { mountCapture } from '../venue/capture.js';
import { openQuickBuilder } from '../venue/quickbuild.js';
import { renderWizard } from '../venue/wizard.js';
import { traceWalls, blobToImageData } from '../venue/importers.js';
import { Simulation } from '../sim/engine.js';
import { serializeLayout, deserializeLayout } from '../sim/layout.js';
import { runBatch } from '../sim/batch.js';
import { analyzeRisk, RISK_NOTE } from '../sim/risk.js';
import { LoopDriver } from '../render/iso.js';
import { FloorPlan2D, renderStaticPlan } from '../render/floorplan.js';
import { renderCompare, densityLegend } from '../ui/compare.js';
import { controller as ctl } from '../sim/controller.js';
import { saveReport, liteRec } from '../reports/store.js';
import { appState } from '../assistant/context.js';

const TOOLS = ['select', 'room', 'corridor', 'wall', 'door', 'exit', 'stairs', 'ramp', 'seating', 'chair', 'stage', 'furniture', 'pillar', 'obstacle', 'zone', 'floorplate'];
const TABS = [['capture', 'camera', 'Capture'], ['blueprint', 'plan', 'Blueprint'], ['3d', 'cube', '3D model'], ['configure', 'layers', 'Configure'], ['results', 'gauge', 'Simulate & analyse']];

export async function mount(root, { id, query }) {
  const venue = await getVenue(id);
  if (!venue) {
    root.innerHTML = `<div class="wrap"><div class="empty-state card" style="margin-top:60px">${icon('building')}<h3>Venue not found</h3><p class="muted">It may have been deleted, or it belongs to another account in this browser.</p><a class="btn" href="#/venues">${icon('arrowLeft')}All venues</a></div></div>`;
    return;
  }
  appState.venue = venue;
  let tab = query?.get('tab') || 'blueprint';
  let cleanupTab = null;
  let saveT = 0;
  root.innerHTML = `
  <div class="vs">
    <header class="vs-head">
      <a class="btn ghost sm" href="#/venues">${icon('arrowLeft')}Venues</a>
      <input class="vs-name" value="${esc(venue.name)}" aria-label="Venue name">
      <span class="vs-save faint small mono" data-save>saved</span>
      <div class="vs-actions">
        <button class="btn sm" data-dup>${icon('compare')}Duplicate</button>
        <button class="btn sm" data-sim>${icon('simulator')}Open in Simulator</button>
      </div>
    </header>
    <nav class="vs-tabs" role="tablist">${TABS.map(([k, ic, l]) => `<button role="tab" data-tab="${k}">${icon(ic)}${l}</button>`).join('')}</nav>
    <div class="vs-body"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const body = $('.vs-body');

  const persist = (immediate) => {
    $('[data-save]').textContent = 'saving…';
    clearTimeout(saveT);
    saveT = setTimeout(async () => { await saveVenue(venue); $('[data-save]').textContent = `saved ${new Date().toLocaleTimeString()}`; }, immediate ? 0 : 500);
  };
  $('.vs-name').addEventListener('change', (e) => { venue.name = e.target.value.trim() || venue.name; venue.config.details.name = venue.name; persist(true); });
  $('[data-dup]').addEventListener('click', async () => { await saveVenue(venue); const c = await duplicateVenue(venue); toast('Duplicated — opening the copy', 'ok'); location.hash = `/venues/${c.id}`; });
  $('[data-sim]').addEventListener('click', () => openInSimulator());

  function openInSimulator(layoutOverride = null) {
    const v = validate(venue);
    if (v.issues.some((i) => i.level === 'error')) { toast(v.issues.find((i) => i.level === 'error').msg, 'warn'); return; }
    const { layout, params } = toSimulation(venue);
    ctl.loadVenue(layoutOverride || layout, params, venueInfo());
    persist(true);
    location.hash = '/simulator';
  }
  function venueInfo() {
    return { id: venue.id, name: venue.name, config: JSON.parse(JSON.stringify(venue.config)), scaleVerified: venue.plan.scaleVerified, area: venue.plan.shapes.filter((s) => s.type === 'room' || s.type === 'corridor').reduce((t, s) => t + rectOf(s).w * rectOf(s).h, 0) };
  }

  function show(t) {
    cleanupTab?.();
    cleanupTab = null;
    tab = t;
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    body.className = `vs-body tab-${t}`;
    if (t === 'capture') cleanupTab = mountCapture(body, venue, { method: query?.get('method') || venue.source.method, onTab: (k) => show(k), onChange: () => persist(), onPlan: (o) => { show('blueprint'); if (o?.calibrate) setTimeout(() => startCalibration(), 50); }, onShapes: (shapes) => { venue.plan.shapes.push(...shapes.map((s) => ({ id: uid(), rot: 0, name: '', ...s }))); persist(true); } });
    else if (t === 'blueprint') cleanupTab = blueprintTab();
    else if (t === '3d') cleanupTab = threeTab();
    else if (t === 'configure') { body.innerHTML = '<div class="wz-host"></div>'; renderWizard(body.querySelector('.wz-host'), venue, { onChange: () => persist(), onRun: () => { persist(true); show('results'); setTimeout(() => body.querySelector('[data-runall]')?.click(), 50); }, onGoBlueprint: (tool) => { show('blueprint'); setTimeout(() => setTool(tool), 30); } }); }
    else if (t === 'results') cleanupTab = resultsTab();
  }
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  /** quick room builder from any tab except the blueprint (which keeps undo) */
  function quick() {
    openQuickBuilder(venue, {
      onBuilt: (r) => {
        $('.vs-name').value = venue.name;
        persist(true);
        toast(`Built ${r.W} × ${r.D} m room: ${r.validation.capacity.seats} seats, ${r.shapes.filter((x) => x.type === 'exit').length} exits`, 'ok');
        show('3d');
      },
    });
  }

  // ================================================================ blueprint
  let editor = null;
  let setTool = () => {};
  let startCalibration = () => {};
  function blueprintTab() {
    body.innerHTML = `
      <div class="bp">
        <div class="bp-tools" role="toolbar" aria-label="Drawing tools">
          ${TOOLS.map((k) => `<button data-tool="${k}" title="${k === 'select' ? 'Select / move (V)' : SHAPE_TYPES[k].label}" aria-pressed="false">${icon(k === 'select' ? 'hand' : SHAPE_TYPES[k].icon)}<span>${k === 'select' ? 'Select' : SHAPE_TYPES[k].label.split(' ')[0]}</span></button>`).join('')}
          <span class="bp-sep"></span>
          <button data-tool="calibrate" title="Calibrate scale on the background">${icon('target')}<span>Calibrate</span></button>
          <button data-tool="pan" title="Pan (or hold Space / right-drag)">${icon('arrows')}<span>Pan</span></button>
        </div>
        <div class="bp-stage">
          <div class="bp-bar">
            <button class="btn sm icon" data-undo title="Undo (Ctrl+Z)" aria-label="Undo">${icon('reset')}</button>
            <button class="btn sm icon" data-redo title="Redo (Ctrl+Y)" aria-label="Redo" style="transform:scaleX(-1)">${icon('reset')}</button>
            <button class="btn sm" data-fit>${icon('zoomOut')}Fit</button>
            <button class="btn sm" data-quick title="Generate the room from its measurements">${icon('cube')}Quick room</button>
            <label class="check small"><input type="checkbox" data-snap checked> Snap 0.25 m</label>
            <label class="check small"><input type="checkbox" data-grid> Engine grid</label>
            <span class="faint small hide-sm">Drag to draw · click to place doors &amp; exits on a wall · R rotate · Del delete · Ctrl+D duplicate</span>
          </div>
          <div class="bp-canvas"></div>
        </div>
        <aside class="bp-side">
          <section class="bp-sec" data-props></section>
          <section class="bp-sec" data-bg></section>
          <section class="bp-sec">
            <div class="mini-h">Plan extent</div>
            <div class="row gap8"><label class="field grow"><span class="label">Width (m)</span><input class="input sm-in" type="number" min="5" max="400" step="1" data-pw value="${venue.plan.width}"></label><label class="field grow"><span class="label">Depth (m)</span><input class="input sm-in" type="number" min="5" max="400" step="1" data-ph value="${venue.plan.height}"></label></div>
          </section>
          <section class="bp-sec" data-val></section>
        </aside>
      </div>`;
    let bgImg = null;
    const loadBg = async () => {
      bgImg = null;
      const id2 = venue.plan.background?.mediaId;
      if (!id2) { editor?.draw(); return; }
      const m = await getMedia(id2);
      if (m) { bgImg = await createImageBitmap(m.blob); bgImg.mediaW = m.w; }
      editor?.draw();
    };
    editor = new BlueprintEditor(body.querySelector('.bp-canvas'), venue, {
      onChange: () => { persist(); renderVal(); },
      onSelect: (s) => renderProps(s),
      onCalibrate: (pts) => finishCalibration(pts),
      getBackground: () => bgImg,
    });
    editor.cb.onTool = (t) => markTool(t);
    editor.cb.onExtent = () => { body.querySelector('[data-pw]').value = venue.plan.width; body.querySelector('[data-ph]').value = venue.plan.height; };
    loadBg();
    const markTool = (t) => body.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    setTool = (t) => { editor.tool = t; editor.calib = null; markTool(t); editor.draw(); };
    markTool('select');
    body.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.tool === 'calibrate' && !venue.plan.background) { toast('Import a floor plan first (Capture → Floor plan), or use “Use as background” on a photo.', 'warn'); return; }
      setTool(b.dataset.tool);
      if (b.dataset.tool === 'calibrate') toast('Click two points on a wall of known length', 'info', 2400);
    }));
    body.querySelector('[data-undo]').addEventListener('click', () => editor.doUndo());
    body.querySelector('[data-redo]').addEventListener('click', () => editor.doRedo());
    body.querySelector('[data-fit]').addEventListener('click', () => editor.fit());
    body.querySelector('[data-quick]').addEventListener('click', () => openQuickBuilder(venue, {
      beforeApply: () => editor.checkpoint(),
      onBuilt: (r) => {
        editor.sel = null;
        body.querySelector('[data-pw]').value = venue.plan.width;
        body.querySelector('[data-ph]').value = venue.plan.height;
        $('.vs-name').value = venue.name;
        editor.changed();
        editor.fit();
        toast(`Built ${r.W} × ${r.D} m room — Ctrl+Z undoes it`, 'ok');
      },
    }));
    body.querySelector('[data-snap]').addEventListener('change', (e) => (editor.snap = e.target.checked));
    body.querySelector('[data-grid]').addEventListener('change', (e) => { editor.showGrid = e.target.checked; editor.grid = null; editor.draw(); });
    body.querySelector('[data-pw]').addEventListener('change', (e) => { venue.plan.width = Math.max(5, Math.min(400, +e.target.value)); editor.fit(); persist(); renderVal(); });
    body.querySelector('[data-ph]').addEventListener('change', (e) => { venue.plan.height = Math.max(5, Math.min(400, +e.target.value)); editor.fit(); persist(); renderVal(); });

    startCalibration = () => { if (!venue.plan.background) return; setTool('calibrate'); toast('Calibrate: click two points on a wall whose real length you know', 'info', 3200); };
    function finishCalibration(pts) {
      const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      const m = openModal({ title: 'Calibrate scale', body: `<form class="pad stack" data-f><p class="muted">The two points are currently ${d.toFixed(2)} m apart on the drawing. Enter the real distance between them, measured on site or taken from a dimension on the plan.</p><div class="field"><label>Real length (m)</label><input class="input" type="number" min="0.1" step="0.01" required autofocus data-len placeholder="e.g. 12"></div><label class="check"><input type="checkbox" data-site> This is an on-site measurement</label><div class="row gap8"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${icon('check')}Apply scale</button></div></form>`, onClose: () => setTool('select') });
      m.body.querySelector('[data-f]').addEventListener('submit', (e) => {
        e.preventDefault();
        const real = +m.body.querySelector('[data-len]').value;
        if (!(real > 0) || !(d > 0)) return;
        const bg = venue.plan.background;
        const f = real / d;
        bg.mPerPx *= f;
        bg.x = (bg.x || 0) * f; bg.y = (bg.y || 0) * f;
        bg.calibrated = true;
        if (bgImg) { venue.plan.width = Math.ceil(bg.x + bgImg.width * bg.mPerPx + 1); venue.plan.height = Math.ceil(bg.y + bgImg.height * bg.mPerPx + 1); }
        if (m.body.querySelector('[data-site]').checked) venue.plan.scaleVerified = true;
        m.close();
        body.querySelector('[data-pw]').value = venue.plan.width; body.querySelector('[data-ph]').value = venue.plan.height;
        editor.calib = null; editor.fit(); persist(true); renderBg(); renderVal();
        toast(`Scale set: 1 px = ${(bg.mPerPx * 100).toFixed(2)} cm`, 'ok');
      });
    }

    function renderBg() {
      const bg = venue.plan.background;
      const el = body.querySelector('[data-bg]');
      if (!bg) { el.innerHTML = `<div class="mini-h">Background</div><p class="faint small">No plan or photo behind the blueprint. Import one on the Capture tab.</p>`; return; }
      el.innerHTML = `<div class="mini-h">Background ${bg.calibrated ? '<span class="chip teal">calibrated</span>' : '<span class="chip amber">not calibrated</span>'}</div>
        <div class="field"><div class="label"><span>Opacity</span><span class="val">${Math.round((bg.opacity ?? 0.55) * 100)} %</span></div><input type="range" min="0.05" max="1" step="0.05" value="${bg.opacity ?? 0.55}" data-op></div>
        <div class="row gap8 wrap-row"><button class="btn sm" data-cal>${icon('target')}Calibrate</button><button class="btn sm ghost" data-rmbg>Remove</button></div>
        <div class="mini-h" style="margin-top:12px">Automatic wall tracing</div>
        <p class="faint small">Turns dark lines of a calibrated line drawing into walls on the 0.5 m grid. Not AI — check and correct the result.</p>
        <div class="field"><div class="label"><span>Darkness threshold</span><span class="val" data-thv>110</span></div><input type="range" min="40" max="200" value="110" data-th></div>
        <div class="field"><div class="label"><span>Minimum ink per cell</span><span class="val" data-fiv>22 %</span></div><input type="range" min="5" max="60" value="22" data-fi></div>
        <div class="row gap8 wrap-row"><button class="btn sm primary" data-trace ${bg.calibrated ? '' : 'disabled title="Calibrate first"'}>${icon('sparkle')}Trace walls</button><button class="btn sm ghost" data-untrace>Remove traced</button></div>
        <p class="small" data-traceout></p>`;
      el.querySelectorAll('input[type="range"]').forEach((r) => syncRange(r));
      el.querySelector('[data-op]').addEventListener('input', (e) => { bg.opacity = +e.target.value; syncRange(e.target); e.target.closest('.field').querySelector('.val').textContent = `${Math.round(bg.opacity * 100)} %`; editor.draw(); persist(); });
      el.querySelector('[data-th]').addEventListener('input', (e) => { syncRange(e.target); el.querySelector('[data-thv]').textContent = e.target.value; });
      el.querySelector('[data-fi]').addEventListener('input', (e) => { syncRange(e.target); el.querySelector('[data-fiv]').textContent = `${e.target.value} %`; });
      el.querySelector('[data-cal]').addEventListener('click', startCalibration);
      el.querySelector('[data-rmbg]').addEventListener('click', () => { venue.plan.background = null; bgImg = null; editor.draw(); persist(true); renderBg(); });
      el.querySelector('[data-untrace]').addEventListener('click', () => { editor.checkpoint(); venue.plan.shapes = venue.plan.shapes.filter((s) => !s.traced); editor.changed(); });
      el.querySelector('[data-trace]').addEventListener('click', async () => {
        const out = el.querySelector('[data-traceout]');
        out.innerHTML = '<span class="spinner"></span> tracing…';
        const m = await getMedia(bg.mediaId);
        const { data, scale } = await blobToImageData(m.blob);
        const res = traceWalls(data, bg.mPerPx / scale, { threshold: +el.querySelector('[data-th]').value, fill: +el.querySelector('[data-fi]').value / 100, offset: { x: bg.x || 0, y: bg.y || 0 } });
        editor.checkpoint();
        venue.plan.shapes = venue.plan.shapes.filter((s) => !s.traced);
        for (const s of res.shapes) venue.plan.shapes.push({ id: uid(), rot: 0, name: '', traced: true, ...s });
        const W = data.width * bg.mPerPx / scale, H = data.height * bg.mPerPx / scale;
        if (!venue.plan.shapes.some((s) => s.type === 'floorplate')) venue.plan.shapes.push({ id: uid(), type: 'floorplate', x: bg.x || 0, y: bg.y || 0, w: W, h: H, rot: 0, name: 'Traced floor', traced: true });
        editor.changed();
        out.innerHTML = `${res.shapes.length} wall segments from ${res.cells} cells. Now place doors and exits, then enable <b>Engine grid</b> to check.`;
      });
    }
    function renderProps(s) {
      const el = body.querySelector('[data-props]');
      if (!s) { el.innerHTML = `<div class="mini-h">Selection</div><p class="faint small">Select an element to edit its name, position, size and rotation.</p>`; return; }
      const def = SHAPE_TYPES[s.type];
      const num = (k, l, v, step = 0.25) => `<label class="field"><span class="label">${l}</span><input class="input sm-in" type="number" step="${step}" data-p="${k}" value="${(+v).toFixed(2)}"></label>`;
      let fields = '';
      if (s.x1 != null) {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), ang = (Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI;
        fields = `<div class="pgrid">${num('x1', 'Start x', s.x1)}${num('y1', 'Start y', s.y1)}${num('len', 'Length (m)', len)}${num('ang', 'Angle (°)', ang, 1)}</div>`;
      } else if (s.width != null) fields = `<div class="pgrid">${num('x', 'x (m)', s.x)}${num('y', 'y (m)', s.y)}${num('width', 'Clear width (m)', s.width)}<label class="field"><span class="label">Orientation</span><select class="input sm-in" data-p="rot"><option value="0" ${s.rot % 180 === 0 ? 'selected' : ''}>Horizontal wall</option><option value="90" ${s.rot % 180 ? 'selected' : ''}>Vertical wall</option></select></label></div>`;
      else fields = `<div class="pgrid">${num('x', 'x (m)', s.x)}${num('y', 'y (m)', s.y)}${num('w', 'Width (m)', s.w)}${num('h', 'Depth (m)', s.h)}</div><div class="row gap8"><span class="faint small">Rotation ${s.rot || 0}°</span><button class="btn sm" data-rot>${icon('rotate')}Rotate 90°</button></div>`;
      if (s.type === 'zone') fields += `<label class="field"><span class="label">Zone type</span><select class="input sm-in" data-p="kind">${Object.entries(ZONE_KINDS).map(([k, z]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${z.label}</option>`).join('')}</select></label>`;
      if (s.type === 'seating') fields += `<label class="field"><span class="label">Row pitch (m)</span><input class="input sm-in" type="number" min="0.8" max="2" step="0.05" data-p="pitch" value="${s.pitch || 1}"></label><p class="faint small">Arrow shows the direction the audience faces.</p>`;
      el.innerHTML = `<div class="mini-h">${def.label}${s.aiDraft ? ' <span class="chip amber">AI draft · unverified</span>' : s.traced ? ' <span class="chip">traced</span>' : ''}</div>
        <label class="field"><span class="label">Name</span><input class="input sm-in" data-p="name" value="${esc(s.name || '')}" placeholder="${def.label}"></label>
        ${fields}
        <div class="row gap8 wrap-row"><button class="btn sm" data-dupe>${icon('compare')}Duplicate</button><button class="btn sm danger" data-rm>${icon('trash')}Delete</button></div>`;
      el.querySelectorAll('[data-p]').forEach((inp) => inp.addEventListener('change', () => {
        const k = inp.dataset.p;
        let v = inp.tagName === 'SELECT' && k !== 'kind' ? +inp.value : inp.type === 'number' ? +inp.value : inp.value;
        if (k === 'name') {
          const old = s.name;
          if ((s.type === 'door' || s.type === 'exit') && old && venue.config.exits[old]) { venue.config.exits[v] = venue.config.exits[old]; delete venue.config.exits[old]; }
          editor.update(s.id, { name: v.trim() }); return;
        }
        if (k === 'len' || k === 'ang') {
          const len = k === 'len' ? Math.max(0.25, v) : Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
          const ang = ((k === 'ang' ? v : (Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI) * Math.PI) / 180;
          editor.update(s.id, { x2: s.x1 + Math.cos(ang) * len, y2: s.y1 + Math.sin(ang) * len }); return;
        }
        if (['w', 'h', 'width'].includes(k)) v = Math.max(0.25, v);
        editor.update(s.id, { [k]: v });
      }));
      el.querySelector('[data-rot]')?.addEventListener('click', () => editor.rotate(s.id));
      el.querySelector('[data-dupe]').addEventListener('click', () => editor.duplicate(s.id));
      el.querySelector('[data-rm]').addEventListener('click', () => editor.remove(s.id));
    }
    function renderVal() {
      const el = body.querySelector('[data-val]');
      let res;
      try { res = validate(venue); } catch (e) { el.innerHTML = `<div class="mini-h">Checks</div><p class="error-text">${esc(e.message)}</p>`; return; }
      const ok = !res.issues.some((i) => i.level !== 'info');
      el.innerHTML = `<div class="mini-h">Checks</div>
        ${res.issues.map((i) => `<div class="vi ${i.level}">${icon(i.level === 'error' ? 'warning' : i.level === 'warn' ? 'warning' : 'info')}<span>${esc(i.msg)}</span></div>`).join('')}
        ${ok ? `<div class="vi ok">${icon('checkCircle')}<span>Geometry is ready to simulate.</span></div>` : ''}
        <p class="faint small">Capacity ≈ ${res.capacity.seats} seats + ${res.capacity.standing} standing spots.</p>`;
    }
    renderProps(null); renderBg(); renderVal();
    return () => { editor.destroy(); editor = null; };
  }

  // ================================================================ 3D model
  function threeTab() {
    const v = validate(venue);
    if (v.issues.some((i) => i.level === 'error')) {
      body.innerHTML = `<div class="wrap narrow"><div class="empty-state card" style="margin-top:40px">${icon('cube')}<h3>Nothing to build yet</h3><p class="muted">${esc(v.issues.find((i) => i.level === 'error').msg)} The 3D model is generated from the blueprint — type in the room’s measurements, draw it, or let the AI draft it from photos on the Capture tab.</p><div class="row gap8 wrap-row" style="justify-content:center"><button class="btn primary" data-quick>${icon('cube')}Quick room builder</button><button class="btn" data-go>${icon('plan')}Open the blueprint</button></div></div></div>`;
      body.querySelector('[data-go]').addEventListener('click', () => show('blueprint'));
      body.querySelector('[data-quick]').addEventListener('click', () => quick());
      return null;
    }
    body.innerHTML = `
      <div class="v3s">
        <div class="v3s-3d"><div class="loading3d"><span class="spinner"></span>Generating the 3D model…</div></div>
        <div class="v3s-side">
          <div class="card pad stack">
            <div class="mini-h">Parametric 3D model</div>
            <p class="small muted">Generated from the blueprint: walls, floors, doors, exits, seating, stage and obstacles are extruded from the same 0.5 m grid the engine uses. Figures are the configured occupants at their start positions.</p>
            <div class="row gap8"><button class="btn primary grow" data-play>${icon('play')}Preview evacuation</button><button class="btn icon" data-restart aria-label="Restart">${icon('reset')}</button></div>
            <div class="mono small" data-read></div>
            ${!venue.plan.scaleVerified ? `<div class="callout amber">${icon('info')}<span>Unverified dimensions — the model shows the layout as drawn.</span></div>` : ''}
          </div>
          <div class="card v3s-2d"><div class="mini-h" style="padding:10px 12px 0">Same state, 2D</div><div class="v3s-plan"></div></div>
        </div>
      </div>`;
    const { layout, params } = toSimulation(venue);
    const driver = new LoopDriver(() => new Simulation(layout, params), { speed: 0, holdEnd: 6 });
    const plan = new FloorPlan2D(body.querySelector('.v3s-plan'), driver, { compact: true, interactive: true, layers: { chips: false } });
    let view = null;
    import('../render/view3d.js').then(({ View3D, webglAvailable }) => {
      const host = body.querySelector('.v3s-3d');
      if (!host) return;
      host.innerHTML = '';
      if (!webglAvailable()) { host.innerHTML = `<div class="loading3d">${icon('warning')}WebGL unavailable — the 2D view shows the same model.</div>`; return; }
      view = new View3D(host, driver, { controls: true, toolbar: true });
    });
    const playBtn = body.querySelector('[data-play]');
    playBtn.addEventListener('click', () => { driver.speed = driver.speed ? 0 : 2; playBtn.innerHTML = driver.speed ? `${icon('pause')}Pause` : `${icon('play')}Preview evacuation`; });
    body.querySelector('[data-restart]').addEventListener('click', () => { driver.sim = new Simulation(layout, params); driver.emit('reset'); });
    const iv = setInterval(() => { const s = driver.sim; body.querySelector('[data-read]').textContent = `t = ${s.t.toFixed(1)} s · ${s.evacuated}/${s.N} out · peak ${s.peak.value.toFixed(2)} p/m²`; }, 250);
    return () => { clearInterval(iv); view?.destroy(); plan.destroy(); driver.stop(); };
  }

  // ================================================================ results
  function resultsTab() {
    body.innerHTML = `
      <div class="wrap res">
        <section class="card pad res-top">
          <div>
            <span class="eyebrow">Scenario</span>
            <h2 class="h2s">${esc(venue.config.sim.scenario || 'Baseline')} <span class="chip">${esc(EMERGENCIES[venue.config.emergency.type]?.label || '')}</span></h2>
            <p class="faint small">${venue.config.population.total} people · ${venue.config.sim.runs} run(s) · seed ${venue.config.sim.seed}${venue.plan.scaleVerified ? '' : ' · dimensions unverified'}</p>
          </div>
          <div class="row gap8 wrap-row">
            <button class="btn amber" data-runall>${icon('play')}Run simulations</button>
            <button class="btn" data-saveScen>${icon('check')}Save scenario</button>
            <button class="btn" data-opensim>${icon('simulator')}Watch in Simulator</button>
          </div>
        </section>
        <section class="scen-list" data-scen></section>
        <div class="progress" data-prog hidden><i></i></div>
        <section data-out></section>
        <section class="card pad" data-hist></section>
      </div>`;
    const out = body.querySelector('[data-out]');
    body.querySelector('[data-opensim]').addEventListener('click', () => openInSimulator());
    body.querySelector('[data-saveScen]').addEventListener('click', () => {
      const name = prompt('Scenario name', venue.config.sim.scenario || 'Scenario');
      if (!name) return;
      venue.config.sim.scenario = name;
      venue.scenarios = venue.scenarios.filter((s) => s.name !== name);
      venue.scenarios.push({ id: uid('sc'), name, at: Date.now(), config: JSON.parse(JSON.stringify(venue.config)), shapes: JSON.parse(JSON.stringify(venue.plan.shapes)) });
      persist(true); renderScen(); toast(`Scenario “${name}” saved`, 'ok');
    });
    function renderScen() {
      const el = body.querySelector('[data-scen]');
      if (!venue.scenarios.length) { el.innerHTML = ''; return; }
      el.innerHTML = `<div class="mini-h">Saved scenarios</div><div class="row gap8 wrap-row">${venue.scenarios.map((s) => `<span class="scen-chip"><button class="btn sm" data-load="${s.id}">${esc(s.name)}</button><button class="btn sm ghost icon" data-dupsc="${s.id}" title="Duplicate" aria-label="Duplicate ${esc(s.name)}">${icon('compare')}</button><button class="btn sm ghost icon" data-delsc="${s.id}" aria-label="Delete ${esc(s.name)}">${icon('x')}</button></span>`).join('')}</div>`;
      el.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => { const s = venue.scenarios.find((x) => x.id === b.dataset.load); venue.config = JSON.parse(JSON.stringify(s.config)); venue.plan.shapes = JSON.parse(JSON.stringify(s.shapes)); persist(true); toast(`Loaded “${s.name}”`, 'ok'); show('results'); }));
      el.querySelectorAll('[data-dupsc]').forEach((b) => b.addEventListener('click', () => { const s = venue.scenarios.find((x) => x.id === b.dataset.dupsc); venue.scenarios.push({ ...JSON.parse(JSON.stringify(s)), id: uid('sc'), name: `${s.name} (copy)`, at: Date.now() }); persist(true); renderScen(); }));
      el.querySelectorAll('[data-delsc]').forEach((b) => b.addEventListener('click', () => { venue.scenarios = venue.scenarios.filter((x) => x.id !== b.dataset.delsc); persist(true); renderScen(); }));
    }
    renderScen();

    body.querySelector('[data-runall]').addEventListener('click', async () => {
      const v = validate(venue);
      const err = v.issues.find((i) => i.level === 'error');
      if (err) { out.innerHTML = `<div class="callout red">${icon('warning')}<span>${esc(err.msg)}</span></div>`; return; }
      const { layout, params } = toSimulation(venue);
      const n = Math.max(1, Math.min(10, +venue.config.sim.runs || 1));
      const prog = body.querySelector('[data-prog]');
      prog.hidden = false;
      out.innerHTML = `<div class="bench-loading"><span class="spinner"></span>Running ${n} full simulation(s) in background workers…</div>`;
      try {
        const res = await runBatch(Array.from({ length: n }, (_, k) => ({ layout, params: { ...params, seed: params.seed + k }, full: k === 0 })), (d, t) => (prog.firstElementChild.style.width = `${(d / t) * 100}%`));
        const first = res[0];
        first.layout = serializeLayout(layout);
        const risk = analyzeRisk(layout, first);
        const run = { id: uid('r'), at: Date.now(), scenario: venue.config.sim.scenario || 'Baseline', emergency: venue.config.emergency.type, n, rsets: res.map((r) => r.rset), t95s: res.map((r) => r.t95), peaks: res.map((r) => r.peakDensity.value), first, risk, params: { ...params, profiles: undefined, spawn: undefined } };
        venue.runs.push(run);
        persist(true);
        renderRun(run, layout, params);
        renderHist();
      } catch (e) { out.innerHTML = `<div class="callout red">${icon('warning')}<span>Simulation failed: ${esc(e.message || e)}</span></div>`; }
      prog.hidden = true;
    });

    function renderRun(run, layout, params) {
      const r = run.first;
      const ok = run.rsets.filter((x) => x != null);
      const mean = ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null;
      out.innerHTML = `
        <div class="res-kpis">
          <div class="kpi"><span>Evacuation time (RSET)</span><b class="num">${fmtSec(mean)}</b><em>${ok.length > 1 ? `range ${Math.min(...ok).toFixed(1)}–${Math.max(...ok).toFixed(1)} s over ${run.n} runs` : 'single run'}${ok.length < run.n ? ` · ${run.n - ok.length} incomplete` : ''}</em></div>
          <div class="kpi"><span>95 % evacuated</span><b class="num">${fmtSec(r.t95)}</b><em>run 1</em></div>
          <div class="kpi"><span>Peak density</span><b class="num">${r.peakDensity.value.toFixed(2)}</b><em>p/m² · LOS ${r.peakDensity.los} · ${esc(r.peakDensity.label)}</em></div>
          <div class="kpi"><span>Evacuated</span><b class="num">${r.evacuated}/${r.occupants}</b><em>mean queuing ${fmtSec(r.meanQueue)}</em></div>
        </div>
        <div class="res-grid">
          <figure class="card pad"><div class="mini-h">Peak density and risk findings</div><div class="res-plan"><canvas></canvas></div>${densityLegend('Peak density')}</figure>
          <div class="card pad"><div class="mini-h">Automatic risk analysis</div><p class="faint small">${esc(RISK_NOTE)}</p><ol class="risk-list">${run.risk.map((f, i) => `<li class="risk ${f.severity}" data-r="${i}" tabindex="0"><span class="rk">${i + 1}</span><div><b>${esc(f.title)}</b><p>${esc(f.detail)}</p></div><span class="chip ${f.severity === 'high' ? 'red' : f.severity === 'medium' ? 'amber' : ''}">${f.severity}</span></li>`).join('') || '<li class="faint">No risks flagged.</li>'}</ol></div>
        </div>
        ${r.profileStats ? `<section class="card pad"><div class="mini-h">Outcome by population group (run 1)</div><table class="ptable compact"><thead><tr><th>Group</th><th>People</th><th>Evacuated</th><th>Mean exit time</th><th>Last out</th></tr></thead><tbody>${r.profileStats.map((p) => `<tr><td>${esc(p.label)}</td><td class="mono">${p.n}</td><td class="mono">${p.evacuated}</td><td class="mono">${fmtSec(p.meanExit)}</td><td class="mono">${fmtSec(p.lastExit)}</td></tr>`).join('')}</tbody></table></section>` : ''}
        <section class="card pad" data-recs><div class="row between"><div><div class="mini-h">Design changes</div><p class="faint small">Re-runs the full simulation for every applicable change — wider doors, extra exit, moved obstacles, new aisles, step-free exits, re-opened routes — on 3 seeds, and compares each with this baseline. Your venue is not modified.</p></div><button class="btn amber" data-rec>${icon('sparkle')}Test design changes</button></div><div data-recout></div></section>
        <div class="row gap8 wrap-row"><button class="btn primary" data-report>${icon('report')}Generate report</button><button class="btn" data-opensim2>${icon('simulator')}Watch in Simulator</button></div>`;
      const cv = out.querySelector('.res-plan canvas');
      const drawPlan = (hi = -1) => {
        const { f } = renderStaticPlan(cv, layout, { map: r.peakMap, markers: [] });
        const ctx = cv.getContext('2d');
        run.risk.forEach((x, i) => {
          if (x.x == null) return;
          const px = f.ox + x.x * f.s, py = f.oy + x.y * f.s, rad = Math.max(10, (x.radius || 1.2) * f.s);
          ctx.strokeStyle = i === hi ? '#ffffff' : x.severity === 'high' ? '#ff7b72' : x.severity === 'medium' ? '#f0bd6c' : '#6fd8c9';
          ctx.lineWidth = i === hi ? 3 : 1.5; ctx.setLineDash(i === hi ? [] : [4, 3]);
          ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(px + rad * 0.7, py - rad * 0.7, 9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#111'; ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), px + rad * 0.7, py - rad * 0.7);
        });
      };
      requestAnimationFrame(() => drawPlan());
      out.querySelectorAll('[data-r]').forEach((li) => { const fn = () => drawPlan(+li.dataset.r); li.addEventListener('mouseenter', fn); li.addEventListener('focus', fn); li.addEventListener('click', fn); });
      out.querySelector('[data-opensim2]').addEventListener('click', () => openInSimulator());
      let recs = null;
      out.querySelector('[data-rec]').addEventListener('click', async () => {
        const ro = out.querySelector('[data-recout]');
        ro.innerHTML = `<div class="rec-run"><div class="row gap8"><span class="spinner"></span><b>Preparing candidate layouts…</b></div><div class="progress"><i></i></div><span class="faint small" data-l></span></div>`;
        const { runRecommendations } = await import('../sim/recommend.js');
        try {
          recs = await runRecommendations(layout, params, (d, t, l) => { ro.querySelector('.progress i').style.width = `${(d / t) * 100}%`; ro.querySelector('[data-l]').textContent = `${d}/${t} · ${l}`; });
          ro.innerHTML = recTable(recs);
          ro.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => {
            const it = recs.items[+b.dataset.cmp];
            const m = openModal({ title: 'Before / after redesign', wide: true, body: '<div class="cmp-host"></div>' });
            const base = { ...recs.baseline.result };
            renderCompare(m.body.querySelector('.cmp-host'), { title: it.title, before: { result: base, layout: serializeLayout(layout) }, after: { result: it.result, layout: it.layout }, saved: it.saved, savedMin: it.savedMin, savedMax: it.savedMax });
          }));
          ro.querySelectorAll('[data-simit]').forEach((b) => b.addEventListener('click', () => openInSimulator(deserializeLayout(recs.items[+b.dataset.simit].layout))));
        } catch (e) { ro.innerHTML = `<div class="callout red">${icon('warning')}<span>${esc(e.message || e)}</span></div>`; }
      });
      out.querySelector('[data-report]').addEventListener('click', () => {
        const rep = saveReport({
          title: `${venue.name} — ${run.scenario}`,
          scenario: `${run.scenario} (${EMERGENCIES[run.emergency]?.label || 'custom'})`,
          scenarioId: 'venue',
          result: r,
          recs: recs ? { baseline: recs.baseline.meanRset, items: recs.items.map(liteRec), runs: recs.runs } : null,
          compare: recs?.items.find((i) => i.significant) ? (() => { const it = recs.items.find((i) => i.significant); return { title: it.title, before: { result: recs.baseline.result, layout: serializeLayout(layout) }, after: { result: it.result, layout: it.layout }, saved: it.saved, savedMin: it.savedMin, savedMax: it.savedMax }; })() : null,
          venue: { ...venueInfo(), runs: run.n, rsets: run.rsets, risk: run.risk, assumptions: ASSUMPTIONS, emergency: EMERGENCIES[run.emergency], profiles: r.profileStats, exits: venue.plan.shapes.filter((s) => s.type === 'door' || s.type === 'exit').map((s) => ({ name: s.name, type: s.type, width: s.width, ...(venue.config.exits[s.name] || {}) })) },
        });
        toast('Report generated', 'ok');
        location.hash = `/reports/${rep.id}`;
      });
    }
    function recTable(recs) {
      const b = recs.baseline.result;
      return `<p class="faint small mono">${recs.runs} simulations · ${(recs.ms / 1000).toFixed(1)} s · baseline mean ${recs.baseline.meanRset.toFixed(1)} s</p>
        <div class="table-card"><table class="ptable compact rec-table"><thead><tr><th>Change</th><th>Original</th><th>Modified</th><th>Difference</th><th>Peak density Δ</th><th>Exit use change</th><th>Trade-offs</th><th></th></tr></thead><tbody>
        ${recs.items.map((it, k) => {
          const diff = (it.exitDiff || []).filter((d) => d.before !== d.after).slice(0, 3).map((d) => `${esc(d.name)} ${d.before ?? 'new'}→${d.after}`).join(', ') || '—';
          return `<tr class="${it.significant ? '' : 'weak'}"><td><b>${esc(it.title)}</b>${it.significant ? '<div><span class="chip teal">helps on every seed</span></div>' : it.complete ? '<div class="faint small">within run-to-run noise</div>' : '<div><span class="chip red">leaves people behind</span></div>'}</td>
            <td class="mono">${fmtSec(b.rset)}</td><td class="mono">${it.complete ? fmtSec(it.result?.rset) : '—'}</td>
            <td class="mono ${it.saved > 0 ? 'pos-t' : ''}">${it.complete ? `${it.saved > 0 ? '−' : '+'}${Math.abs(it.saved).toFixed(1)} s` : '—'}<div class="faint small">${it.complete ? `${it.savedMin.toFixed(1)} to ${it.savedMax.toFixed(1)} s saved` : ''}</div></td>
            <td class="mono">${it.peakDelta > 0 ? '+' : ''}${it.peakDelta.toFixed(2)}</td><td class="small">${diff}</td><td class="small faint">${esc(it.tradeoff || '')}</td>
            <td><div class="row gap8"><button class="btn sm" data-cmp="${k}">${icon('compare')}Compare</button><button class="btn sm ghost" data-simit="${k}" title="Open this modified layout in the Simulator">${icon('simulator')}</button></div></td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    function renderHist() {
      const el = body.querySelector('[data-hist]');
      if (!venue.runs.length) { el.innerHTML = `<div class="mini-h">Run history</div><p class="faint small">No runs yet.</p>`; return; }
      el.innerHTML = `<div class="row between"><div class="mini-h">Run history — select two to compare</div><button class="btn sm" data-cmpruns disabled>${icon('compare')}Compare selected</button></div>
        <table class="ptable compact"><thead><tr><th></th><th>When</th><th>Scenario</th><th>Runs</th><th>RSET (run 1)</th><th>Mean RSET</th><th>Peak</th></tr></thead><tbody>
        ${venue.runs.slice().reverse().map((r) => { const ok = r.rsets.filter((x) => x != null); return `<tr><td><input type="checkbox" data-pick="${r.id}" aria-label="Select run"></td><td class="small">${new Date(r.at).toLocaleString()}</td><td>${esc(r.scenario)}</td><td class="mono">${r.n}</td><td class="mono">${fmtSec(r.rsets[0])}</td><td class="mono">${ok.length ? fmtSec(ok.reduce((s, x) => s + x, 0) / ok.length) : '—'}</td><td class="mono">${r.peaks[0].toFixed(2)}</td></tr>`; }).join('')}</tbody></table>`;
      const picks = () => [...el.querySelectorAll('[data-pick]:checked')].map((x) => x.dataset.pick);
      el.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => { el.querySelector('[data-cmpruns]').disabled = picks().length !== 2; }));
      el.querySelector('[data-cmpruns]').addEventListener('click', () => {
        const [a, b] = picks().map((id2) => venue.runs.find((r) => r.id === id2)).sort((x, y) => x.at - y.at);
        const m = openModal({ title: `Compare runs: ${a.scenario} → ${b.scenario}`, wide: true, body: '<div class="cmp-host"></div>' });
        renderCompare(m.body.querySelector('.cmp-host'), { title: `${a.scenario} (${new Date(a.at).toLocaleTimeString()}) versus ${b.scenario} (${new Date(b.at).toLocaleTimeString()})`, before: { result: a.first, layout: a.first.layout }, after: { result: b.first, layout: b.first.layout } });
      });
    }
    renderHist();
    const last = venue.runs.at(-1);
    if (last && last.first?.layout) renderRun(last, deserializeLayout(last.first.layout), toSimulation(venue).params);
    return null;
  }

  show(tab);
  if (query?.get('quick') === '1') setTimeout(quick, 60);
  return () => { appState.venue = null; cleanupTab?.(); clearTimeout(saveT); saveVenue(venue); };
}
