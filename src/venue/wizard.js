// Advanced Venue Configuration Wizard (10 steps). Writes into venue.config
// (and, for dimensions/exits, into the plan shapes). Every value maps onto an
// engine input in model.toSimulation(); assumptions are stated where made.
import { icon } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { EMERGENCIES, ZONE_KINDS, rectOf, buildProfiles, ASSUMPTIONS } from './model.js';

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; };

const opt = (arr) => arr.map((v) => (Array.isArray(v) ? { v: v[0], l: v[1] } : { v, l: v }));

export const STEPS = [
  { id: 'details', t: 'Venue details', d: 'What kind of venue this is and how many people it normally holds.', fields: [
    { k: 'details.name', l: 'Venue name', type: 'text', req: true },
    { k: 'details.buildingType', l: 'Building type', type: 'select', o: opt(['Educational', 'Commercial', 'Assembly', 'Residential', 'Healthcare', 'Industrial', 'Transport', 'Other']) },
    { k: 'details.category', l: 'Venue category', type: 'select', o: opt(['Auditorium / seminar hall', 'Classroom', 'Exhibition hall', 'Sports hall', 'Cafeteria', 'Office floor', 'Shopping area', 'Station concourse', 'Other']) },
    { k: 'details.floor', l: 'Floor number', type: 'number', min: -5, max: 120, adv: true },
    { k: 'details.totalFloors', l: 'Total floors', type: 'number', min: 1, max: 120, adv: true },
    { k: 'details.indoor', l: 'Indoor venue', type: 'toggle' },
    { k: 'details.normalOcc', l: 'Normal occupancy', type: 'number', min: 0, max: 5000, unit: 'people', req: true },
    { k: 'details.maxOcc', l: 'Maximum permitted occupancy', type: 'number', min: 0, max: 5000, unit: 'people', tip: 'From the venue licence or fire NOC, if known.' },
  ] },
  { id: 'dimensions', t: 'Dimensions', d: 'Measured sizes of rooms, corridors and openings. Edit them here or on the blueprint.', custom: 'dimensions' },
  { id: 'population', t: 'Population', d: 'How many people, and where they are when the alarm sounds.', custom: 'population' },
  { id: 'age', t: 'Age distribution', d: 'Age changes walking speed, body size and reaction time.', custom: 'age' },
  { id: 'mobility', t: 'Mobility & accessibility', d: 'People who move differently or need help. Counts are taken out of the total.', fields: [
    { k: 'mobility.wheelchair', l: 'Wheelchair users', type: 'number', min: 0, max: 200, tip: 'Need 0.72 m clear width and avoid exits you mark as not step-free; stairs are an assisted carry.' },
    { k: 'mobility.walkingAid', l: 'People using walking aids', type: 'number', min: 0, max: 200 },
    { k: 'mobility.injured', l: 'Temporary injuries', type: 'number', min: 0, max: 200, adv: true },
    { k: 'mobility.reduced', l: 'Other reduced mobility', type: 'number', min: 0, max: 500 },
    { k: 'mobility.visual', l: 'Visually impaired', type: 'number', min: 0, max: 200, adv: true },
    { k: 'mobility.hearing', l: 'Hearing impaired', type: 'number', min: 0, max: 200, adv: true, tip: 'React 20 s later unless a voice + visual alarm is fitted (step 9).' },
    { k: 'mobility.assisted', l: 'People requiring assistance', type: 'number', min: 0, max: 200 },
    { k: 'mobility.caregivers', l: 'Caregivers', type: 'number', min: 0, max: 200, tip: 'Move at the pace of the person they help.' },
  ] },
  { id: 'behaviour', t: 'Behaviour & familiarity', d: 'Who knows the building, and who responds first.', fields: [
    { k: 'behaviour.familiarPct', l: 'Familiar with the venue', type: 'range', min: 0, max: 100, unit: '%', tip: 'The rest are first-time visitors who prefer the way they came in (main entrance).' },
    { k: 'behaviour.staff', l: 'Staff members', type: 'number', min: 0, max: 200, tip: 'Know every exit and react twice as fast.' },
    { k: 'behaviour.security', l: 'Security personnel', type: 'number', min: 0, max: 200 },
    { k: 'environment.preMin', l: 'Reaction time, shortest', type: 'number', min: 0, max: 300, unit: 's', req: true },
    { k: 'environment.preMax', l: 'Reaction time, longest', type: 'number', min: 0, max: 600, unit: 's', req: true },
    { k: 'behaviour.groupPct', l: 'Moving in groups', type: 'range', min: 0, max: 100, unit: '%', adv: true, tip: 'Recorded for the report only — group cohesion is not modelled by the engine yet.' },
  ] },
  { id: 'emergency', t: 'Emergency type', d: 'Only effects the engine can simulate are applied; the rest are listed as assumptions.', custom: 'emergency' },
  { id: 'exits', t: 'Exit configuration', d: 'Width, availability, accessibility and capacity of every door and exit.', custom: 'exits' },
  { id: 'environment', t: 'Environment & response', d: 'Conditions that slow people down or delay the start of evacuation.', fields: [
    { k: 'environment.lighting', l: 'Lighting', type: 'select', o: opt([['normal', 'Normal'], ['dim', 'Dim'], ['dark', 'Power failure / dark']]) },
    { k: 'environment.emergencyLighting', l: 'Emergency lighting fitted', type: 'toggle' },
    { k: 'environment.visibility', l: 'Visibility', type: 'select', o: opt([['good', 'Good'], ['reduced', 'Reduced'], ['poor', 'Poor (dense smoke)']]) },
    { k: 'environment.signage', l: 'Exit signage', type: 'select', o: opt([['good', 'Clear, illuminated'], ['partial', 'Partial'], ['none', 'None']]) },
    { k: 'environment.alarm', l: 'Alarm', type: 'select', o: opt([['automatic', 'Automatic sounder'], ['voice-visual', 'Voice + visual (strobe)'], ['manual', 'Manual call point'], ['none', 'No alarm']]) },
    { k: 'environment.floor', l: 'Floor condition', type: 'select', o: opt([['dry', 'Dry'], ['wet', 'Wet'], ['debris', 'Debris']]) },
    { k: 'environment.detectionDelay', l: 'Detection delay', type: 'number', min: 0, max: 600, unit: 's', adv: true },
    { k: 'environment.alarmDelay', l: 'Alarm delay', type: 'number', min: 0, max: 600, unit: 's' },
    { k: 'environment.staffResponse', l: 'Staff response time', type: 'number', min: 0, max: 600, unit: 's', adv: true, tip: 'Recorded for the report; staff already react faster in the model.' },
  ] },
  { id: 'sim', t: 'Simulation settings', d: 'How the virtual drill is run.', fields: [
    { k: 'sim.scenario', l: 'Scenario name', type: 'text', req: true },
    { k: 'population.total', l: 'Crowd size', type: 'number', min: 1, max: 1500, unit: 'people', req: true },
    { k: 'sim.panic', l: 'Panic level', type: 'range', min: 0, max: 1, step: 0.05, tip: 'Higher = faster walking but door clogging (faster-is-slower).' },
    { k: 'sim.doorFlow', l: 'Door flow assumption', type: 'number', min: 0.6, max: 2, step: 0.01, unit: 'p/s/m', adv: true, tip: 'Default 1.33 (SFPE specific flow).' },
    { k: 'sim.maxTime', l: 'Maximum simulated time', type: 'number', min: 60, max: 3600, unit: 's', adv: true },
    { k: 'sim.runs', l: 'Number of runs', type: 'number', min: 1, max: 10, tip: 'Different random seeds; results show the spread.' },
    { k: 'sim.seed', l: 'Random seed', type: 'number', min: 1, max: 99999, adv: true },
  ] },
];

export function validateStep(id, v) {
  const c = v.config, e = {};
  const step = STEPS.find((s) => s.id === id);
  for (const f of step.fields || []) {
    const val = get(c, f.k);
    if (f.req && (val === '' || val == null)) e[f.k] = 'Required';
    if (f.type === 'number' && val !== '' && val != null) {
      if (!isFinite(+val)) e[f.k] = 'Enter a number';
      else if (f.min != null && +val < f.min) e[f.k] = `Minimum ${f.min}`;
      else if (f.max != null && +val > f.max) e[f.k] = `Maximum ${f.max}`;
    }
  }
  if (id === 'behaviour' && +c.environment.preMax < +c.environment.preMin) e['environment.preMax'] = 'Must be ≥ the shortest reaction time';
  if (id === 'details' && +c.details.maxOcc && +c.details.normalOcc > +c.details.maxOcc) e['details.normalOcc'] = 'Exceeds the maximum occupancy';
  if (id === 'mobility' || id === 'population') {
    const special = Object.values(c.mobility).reduce((s, x) => s + (+x || 0), 0) + (+c.behaviour.staff || 0) + (+c.behaviour.security || 0);
    if (special > +c.population.total) e._ = `Special groups (${special}) exceed the total of ${c.population.total} people.`;
  }
  if (id === 'age' && c.age.unit === 'percent') { const s = ['children', 'teens', 'adults', 'seniors'].reduce((t, k) => t + (+c.age[k] || 0), 0); if (Math.abs(s - 100) > 0.5) e._ = `Percentages add up to ${s} % — they should total 100 %.`; }
  if (id === 'exits') { const open = (v.plan.shapes.filter((s) => s.type === 'exit')).filter((s) => c.exits[s.name]?.open !== false); if (!open.length) e._ = 'At least one emergency exit must stay open.'; }
  if (id === 'population') { const s = ['seats', 'standing', 'corridors', 'entrances'].reduce((t, k) => t + (+c.population[k] || 0), 0); if (s <= 0) e._ = 'Choose where people are located.'; }
  return e;
}

function fieldHTML(f, v, err, mode) {
  if (f.adv && mode !== 'advanced') return '';
  const val = get(v.config, f.k);
  const id = `wz-${f.k.replace(/\./g, '-')}`;
  const tip = f.tip ? `<span class="hint">${esc(f.tip)}</span>` : '';
  const er = err ? `<span class="error-text">${icon('warning')}${esc(err)}</span>` : '';
  if (f.type === 'toggle') return `<div class="field wz-f"><label class="row between"><span>${f.l}</span><span class="toggle"><input type="checkbox" id="${id}" data-k="${f.k}" ${val ? 'checked' : ''}><span></span></span></label>${tip}</div>`;
  if (f.type === 'select') return `<div class="field wz-f"><label for="${id}">${f.l}</label><select class="input" id="${id}" data-k="${f.k}">${f.o.map((o) => `<option value="${esc(o.v)}" ${String(val) === String(o.v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>${tip}${er}</div>`;
  if (f.type === 'range') return `<div class="field wz-f"><div class="label"><span>${f.l}</span><span class="val" data-val="${f.k}">${val}${f.unit ? ` ${f.unit}` : ''}</span></div><input type="range" id="${id}" data-k="${f.k}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${val}">${tip}</div>`;
  return `<div class="field wz-f"><label for="${id}">${f.l}${f.unit ? ` <span class="faint">(${f.unit})</span>` : ''}${f.req ? ' <span class="faint">*</span>' : ''}</label><input class="input" id="${id}" data-k="${f.k}" type="${f.type === 'number' ? 'number' : 'text'}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} value="${esc(val ?? '')}" aria-invalid="${err ? 'true' : 'false'}">${tip}${er}</div>`;
}

function customHTML(step, v, errs, mode) {
  const c = v.config;
  const S = v.plan.shapes;
  if (step.custom === 'dimensions') {
    const areas = S.filter((s) => ['room', 'corridor', 'stairs', 'ramp'].includes(s.type));
    const ops = S.filter((s) => s.type === 'door' || s.type === 'exit');
    const rows = areas.map((s) => { const r = rectOf(s); return `<tr><td>${esc(s.name || s.type)}</td><td class="faint">${s.type}</td><td><input class="input sm-in" type="number" step="0.25" min="0.5" data-shape="${s.id}" data-dim="L" value="${r.w.toFixed(2)}"></td><td><input class="input sm-in" type="number" step="0.25" min="0.5" data-shape="${s.id}" data-dim="W" value="${r.h.toFixed(2)}"></td><td class="mono">${(r.w * r.h).toFixed(1)} m²</td></tr>`; }).join('');
    const orows = ops.map((s) => `<tr><td>${esc(s.name)}</td><td class="faint">${s.type}</td><td><input class="input sm-in" type="number" step="0.25" min="0.5" max="8" data-shape="${s.id}" data-dim="width" value="${s.width.toFixed(2)}"></td><td colspan="2" class="faint">${s.rot % 180 ? 'vertical wall' : 'horizontal wall'}</td></tr>`).join('');
    const area = areas.filter((s) => s.type !== 'stairs' && s.type !== 'ramp').reduce((t, s) => t + rectOf(s).w * rectOf(s).h, 0);
    return `
      <div class="callout ${v.plan.scaleVerified ? 'teal' : 'amber'}">${icon(v.plan.scaleVerified ? 'checkCircle' : 'info')}<span>${v.plan.scaleVerified ? 'Dimensions are marked as verified by on-site measurement.' : '<b>Unverified dimensions.</b> Sizes come from drawing, calibration or estimation. Measure on site and tick the box below once confirmed.'}</span></div>
      <label class="check"><input type="checkbox" data-verify ${v.plan.scaleVerified ? 'checked' : ''}> Dimensions verified on site</label>
      <div class="table-card card"><table class="ptable compact"><thead><tr><th>Space</th><th>Type</th><th>Length (m)</th><th>Width (m)</th><th>Area</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="faint">No rooms yet — draw them on the blueprint.</td></tr>'}</tbody></table></div>
      <div class="table-card card"><table class="ptable compact"><thead><tr><th>Opening</th><th>Type</th><th>Clear width (m)</th><th colspan="2"></th></tr></thead><tbody>${orows || '<tr><td colspan="5" class="faint">No doors or exits yet.</td></tr>'}</tbody></table></div>
      <div class="wz-grid">
        <div class="field"><label>Total floor area</label><div class="mono">${area.toFixed(1)} m²</div></div>
        ${fieldHTML({ k: 'dimensions.ceiling', l: 'Ceiling height', type: 'number', min: 2, max: 30, step: 0.1, unit: 'm', tip: 'Recorded for the report (smoke layers are not simulated).' }, v, errs['dimensions.ceiling'], mode)}
        ${fieldHTML({ k: 'dimensions.stairWidth', l: 'Staircase width', type: 'number', min: 0.5, max: 10, step: 0.1, unit: 'm', adv: true }, v, null, mode)}
        ${fieldHTML({ k: 'dimensions.rampWidth', l: 'Ramp width', type: 'number', min: 0.5, max: 10, step: 0.1, unit: 'm', adv: true }, v, null, mode)}
      </div>
      <p class="faint small">Rooms: ${areas.filter((s) => s.type === 'room').length} · furniture and obstacles: ${S.filter((s) => ['furniture', 'obstacle', 'pillar'].includes(s.type)).length} (positions are edited on the blueprint).</p>`;
  }
  if (step.custom === 'population') {
    const rooms = S.filter((s) => s.type === 'room');
    const p = c.population;
    const sum = ['seats', 'standing', 'corridors', 'entrances'].reduce((t, k) => t + (+p[k] || 0), 0) || 1;
    const sl = (k, l) => `<div class="field"><div class="label"><span>${l}</span><span class="val">${Math.round(((+p[k] || 0) / sum) * p.total)} people</span></div><input type="range" min="0" max="100" value="${p[k]}" data-k="population.${k}"></div>`;
    return `
      ${fieldHTML({ k: 'population.total', l: 'Total people', type: 'number', min: 1, max: 1500, req: true, unit: 'people' }, v, errs['population.total'], mode)}
      <div class="mini-h">Where people are at the alarm (relative weights)</div>
      ${sl('seats', 'Seated')}${sl('standing', 'Standing in rooms')}${sl('corridors', 'In corridors')}${sl('entrances', 'Near entrances')}
      ${rooms.length > 1 || mode === 'advanced' ? `<div class="mini-h">Room-wise distribution (weights)</div>${rooms.map((r) => `<div class="field"><div class="label"><span>${esc(r.name || 'Room')}</span><span class="val">${p.rooms?.[r.name] ?? 1}</span></div><input type="range" min="0" max="5" step="0.5" value="${p.rooms?.[r.name] ?? 1}" data-room="${esc(r.name || '')}"></div>`).join('')}` : ''}`;
  }
  if (step.custom === 'age') {
    const a = c.age;
    const unit = a.unit;
    const row = (k, l, note) => `<div class="field"><div class="label"><span>${l} <span class="faint">${note}</span></span><span class="val">${a[k]}${unit === 'percent' ? ' %' : ''}</span></div><input type="${unit === 'percent' ? 'range' : 'number'}" class="${unit === 'percent' ? '' : 'input'}" min="0" max="${unit === 'percent' ? 100 : 1500}" value="${a[k]}" data-k="age.${k}"></div>`;
    const prof = buildProfiles(c);
    return `
      <div class="seg" role="group" aria-label="Units"><button data-ageunit="percent" aria-pressed="${unit === 'percent'}">Percentages</button><button data-ageunit="count" aria-pressed="${unit === 'count'}">Numbers</button></div>
      ${row('children', 'Children', '0–12 · 0.9–1.25 m/s')}${row('teens', 'Teenagers', '13–17 · 1.1–1.5 m/s')}${row('adults', 'Adults', '18–59 · 1.34 ± 0.15 m/s')}${row('seniors', 'Senior citizens', '60+ · 0.75–1.05 m/s')}
      <div class="mini-h">Resulting population used by the engine</div>
      <div class="chips-wrap">${prof.map((p) => `<span class="chip">${esc(p.label)} · ${p.n}</span>`).join('')}</div>`;
  }
  if (step.custom === 'emergency') {
    const t = c.emergency.type;
    const e = EMERGENCIES[t];
    const zones = S.filter((s) => s.type === 'zone');
    return `
      <div class="em-grid" role="radiogroup">${Object.entries(EMERGENCIES).map(([k, x]) => `<button role="radio" aria-checked="${k === t}" data-em="${k}">${esc(x.label)}</button>`).join('')}</div>
      <div class="em-cols">
        <div class="callout teal">${icon('check')}<span><b>Simulated</b><br>${e.sim.map(esc).join('<br>') || '—'}</span></div>
        <div class="callout amber">${icon('info')}<span><b>Not simulated — scenario assumptions only</b><br>${e.notSim.map(esc).join('<br>') || 'None for this type'}</span></div>
      </div>
      <div class="mini-h">Hazard locations, restricted zones and blocked routes (${zones.length})</div>
      ${zones.length ? `<ul class="zl">${zones.map((z) => `<li><span class="chip ${ZONE_KINDS[z.kind]?.blocks ? 'red' : ''}">${esc(ZONE_KINDS[z.kind]?.label || z.kind)}</span> ${esc(z.name || '')} <span class="faint mono">${rectOf(z).w.toFixed(1)} × ${rectOf(z).h.toFixed(1)} m</span></li>`).join('')}</ul>` : '<p class="faint small">None yet.</p>'}
      <button class="btn sm" data-addzone>${icon('heat')}Draw a zone on the blueprint</button>
      <div class="field"><label>Scenario notes</label><textarea class="input" rows="2" data-k="emergency.notes" style="height:auto;padding:10px">${esc(c.emergency.notes || '')}</textarea></div>`;
  }
  if (step.custom === 'exits') {
    const ops = S.filter((s) => s.type === 'door' || s.type === 'exit');
    const corridors = S.filter((s) => s.type === 'corridor' || s.type === 'stairs').map((s) => s.name || s.type);
    if (!ops.length) return '<p class="faint">No doors or exits on the blueprint yet.</p>';
    return `<div class="table-card card"><table class="ptable compact exit-table"><thead><tr><th>Opening</th><th>Width</th><th>Type</th><th>Open</th><th>Step-free</th><th>Main entrance</th>${mode === 'advanced' ? '<th>Flow (p/s/m)</th><th>Connects to</th>' : ''}</tr></thead><tbody>
      ${ops.map((s) => { const e = c.exits[s.name] || {}; return `<tr data-exit="${esc(s.name)}"><td><b>${esc(s.name)}</b><div class="faint small">${s.type === 'exit' ? 'final exit' : 'internal door'}</div></td>
        <td><input class="input sm-in" type="number" step="0.25" min="0.5" max="8" data-shape="${s.id}" data-dim="width" value="${s.width.toFixed(2)}"></td>
        <td><select class="input sm-in" data-ex="type">${opt([['door', 'Door'], ['double', 'Double door'], ['stair', 'To stair'], ['ramp', 'To ramp'], ['outdoor', 'To outside']]).map((o) => `<option value="${o.v}" ${(e.type || 'door') === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select></td>
        <td><span class="toggle"><input type="checkbox" data-ex="open" ${e.open !== false ? 'checked' : ''} aria-label="${esc(s.name)} open"><span></span></span></td>
        <td><span class="toggle"><input type="checkbox" data-ex="accessible" ${e.accessible !== false ? 'checked' : ''} aria-label="${esc(s.name)} step-free"><span></span></span></td>
        <td>${s.type === 'exit' ? `<input type="radio" name="mainex" data-ex="main" ${e.main ? 'checked' : ''} aria-label="${esc(s.name)} main entrance">` : ''}</td>
        ${mode === 'advanced' ? `<td><input class="input sm-in" type="number" step="0.01" min="0.5" max="2" data-ex="flow" value="${e.flow || (e.type === 'stair' ? 1.1 : c.sim.doorFlow)}"></td><td><select class="input sm-in" data-ex="connected"><option value="">—</option>${corridors.map((n) => `<option ${e.connected === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></td>` : ''}
      </tr>`; }).join('')}</tbody></table></div>
      <p class="faint small">Capacity assumption: discharge = clear width × flow (default 1.33 p/s/m; 1.1 for stairs). Closed openings are treated as walls. Wheelchair users avoid exits that are not step-free.</p>`;
  }
  return '';
}

export function renderWizard(host, venue, { onChange, onRun, onGoBlueprint, stepIndex = 0 } = {}) {
  let idx = stepIndex;
  let errs = {};
  const draw = () => {
    const mode = venue.config.mode;
    const step = STEPS[idx];
    host.innerHTML = `
      <div class="wz">
        <nav class="wz-steps" aria-label="Configuration steps">
          <div class="seg wz-mode" role="group" aria-label="Mode"><button data-mode="beginner" aria-pressed="${mode === 'beginner'}">Beginner</button><button data-mode="advanced" aria-pressed="${mode === 'advanced'}">Advanced</button></div>
          ${STEPS.map((s, i) => { const bad = Object.keys(validateStep(s.id, venue)).length; return `<button class="wz-step ${i === idx ? 'on' : ''}" data-step="${i}"><span class="mono">${String(i + 1).padStart(2, '0')}</span><span>${s.t}</span>${bad ? `<i class="wz-bad" title="Needs attention">${icon('warning')}</i>` : `<i class="wz-ok">${icon('check')}</i>`}</button>`; }).join('')}
        </nav>
        <section class="wz-body">
          <div class="wz-head"><span class="eyebrow">Step ${idx + 1} of ${STEPS.length}</span><h2>${step.t}</h2><p class="muted">${step.d}</p></div>
          ${errs._ ? `<div class="callout red">${icon('warning')}<span>${esc(errs._)}</span></div>` : ''}
          <div class="wz-fields ${step.custom ? 'custom' : ''}">${step.custom ? customHTML(step, venue, errs, mode) : step.fields.map((f) => fieldHTML(f, venue, errs[f.k], mode)).join('')}</div>
          ${idx === STEPS.length - 1 ? `<details class="assume"><summary>${icon('info')}Model assumptions applied to this configuration</summary><ul>${ASSUMPTIONS.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}
          <div class="wz-nav">
            <button class="btn" data-prev ${idx === 0 ? 'disabled' : ''}>${icon('arrowLeft')}Back</button>
            <span class="faint small">Progress is saved automatically</span>
            ${idx < STEPS.length - 1 ? `<button class="btn primary" data-next>Next${icon('arrowRight')}</button>` : `<button class="btn amber" data-run>${icon('play')}Validate &amp; run simulation</button>`}
          </div>
        </section>
      </div>`;
    bindAll();
  };
  const commit = () => { onChange?.(); };
  const bindAll = () => {
    host.querySelectorAll('[data-k]').forEach((el) => {
      const ev = el.type === 'range' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        let val = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'number' || el.type === 'range') val = val === '' ? '' : +val;
        set(venue.config, el.dataset.k, val);
        if (el.dataset.k === 'details.name' && val) venue.name = val;
        const lab = host.querySelector(`[data-val="${el.dataset.k}"]`);
        if (lab) lab.textContent = `${val}${el.closest('.field')?.querySelector('.val')?.textContent.includes('%') ? ' %' : ''}`;
        commit();
        if (el.type === 'range' && (el.dataset.k.startsWith('population.') || el.dataset.k.startsWith('age.'))) { clearTimeout(bindAll.t); bindAll.t = setTimeout(draw, 250); }
      });
    });
    host.querySelectorAll('[data-room]').forEach((el) => el.addEventListener('change', () => { venue.config.population.rooms[el.dataset.room] = +el.value; commit(); draw(); }));
    host.querySelectorAll('[data-shape]').forEach((el) => el.addEventListener('change', () => {
      const s = venue.plan.shapes.find((q) => q.id === el.dataset.shape);
      const v = Math.max(0.5, +el.value);
      if (el.dataset.dim === 'width') s.width = v;
      else { const swap = s.rot % 180 !== 0; const key = (el.dataset.dim === 'L') !== swap ? 'w' : 'h'; s[key] = v; }
      commit(); draw();
    }));
    host.querySelector('[data-verify]')?.addEventListener('change', (e) => { venue.plan.scaleVerified = e.target.checked; commit(); draw(); });
    host.querySelectorAll('[data-ageunit]').forEach((b) => b.addEventListener('click', () => { venue.config.age.unit = b.dataset.ageunit; commit(); draw(); }));
    host.querySelectorAll('[data-em]').forEach((b) => b.addEventListener('click', () => { venue.config.emergency.type = b.dataset.em; commit(); draw(); }));
    host.querySelector('[data-addzone]')?.addEventListener('click', () => onGoBlueprint?.('zone'));
    host.querySelectorAll('tr[data-exit]').forEach((tr) => {
      const name = tr.dataset.exit;
      tr.querySelectorAll('[data-ex]').forEach((el) => el.addEventListener('change', () => {
        const e = (venue.config.exits[name] ??= {});
        const k = el.dataset.ex;
        if (k === 'main') { for (const x of Object.values(venue.config.exits)) x.main = false; e.main = true; }
        else e[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
        commit();
      }));
    });
    host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { venue.config.mode = b.dataset.mode; commit(); draw(); }));
    host.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { idx = +b.dataset.step; errs = {}; draw(); }));
    host.querySelector('[data-prev]')?.addEventListener('click', () => { idx--; errs = {}; draw(); });
    host.querySelector('[data-next]')?.addEventListener('click', () => { errs = validateStep(STEPS[idx].id, venue); if (Object.keys(errs).length) { draw(); return; } idx++; draw(); });
    host.querySelector('[data-run]')?.addEventListener('click', () => {
      for (let i = 0; i < STEPS.length; i++) { const e = validateStep(STEPS[i].id, venue); if (Object.keys(e).length) { idx = i; errs = e; draw(); return; } }
      onRun?.();
    });
  };
  draw();
  return { refresh: draw, get step() { return idx; } };
}
