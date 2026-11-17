import { icon } from '../ui/icons.js';
import { esc, toast, openModal } from '../ui/dom.js';
import { listVenues, saveVenue, deleteVenue, duplicateVenue } from '../venue/store.js';
import { newVenue, templateHall, rasterize } from '../venue/model.js';
import { renderStaticPlan } from '../render/floorplan.js';

const METHODS = [
  ['camera', 'camera', 'Capture with camera', 'Photograph the room, entrances, exits, corridors and obstacles with a guided checklist.'],
  ['upload', 'download', 'Upload images or video', 'JPG, PNG, WEBP photos or an MP4 walkthrough — representative frames are extracted.'],
  ['plan', 'plan', 'Upload a floor plan', 'PDF, PNG, JPG, SVG or DXF. Calibrate the scale with one known measurement, then trace walls.'],
  ['manual', 'edit', 'Create manually', 'Draw rooms, corridors, doors, exits, stairs, seating and obstacles in the blueprint editor.'],
];

export async function mount(root) {
  root.innerHTML = `
  <div class="wrap">
    <header class="page-head">
      <span class="eyebrow">Venue Studio</span>
      <h1>Smart Venue Capture &amp; Digital Twin Builder</h1>
      <p>Build a digital model of the venue you want to test — from photos, a floor plan or by drawing it — configure who is inside and what goes wrong, then run it in the same EvacPrint engine.</p>
    </header>
    <section class="vm-grid">
      ${METHODS.map(([k, ic, t, d]) => `<button class="vm card" data-new="${k}"><span class="vm-ic">${icon(ic)}</span><b>${t}</b><span>${d}</span><span class="vm-go">${icon('arrowRight')}</span></button>`).join('')}
    </section>
    <div class="row gap8 vm-extra"><button class="btn sm" data-quick>${icon('cube')}Quick room from measurements (no AI)</button><button class="btn sm ghost" data-template>${icon('building')}Start from a lecture-room template</button><span class="faint small">Photos give visual reference; real dimensions come from a calibrated plan or your own measurements.</span></div>
    <section class="section">
      <div class="row between"><h2 class="h2s">Your venues</h2><span class="faint small" data-n></span></div>
      <div class="vl" data-list><div class="bench-loading"><span class="spinner"></span>Loading…</div></div>
    </section>
  </div>`;
  const $ = (s) => root.querySelector(s);

  const create = async (method, v = newVenue()) => {
    v.source.method = method;
    await saveVenue(v);
    location.hash = `/venues/${v.id}?tab=${method === 'manual' ? 'blueprint' : 'capture'}&method=${method}`;
  };
  root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => create(b.dataset.new)));
  $('[data-template]').addEventListener('click', () => create('manual', templateHall()));
  $('[data-quick]').addEventListener('click', async () => { const v = newVenue(); v.source.method = 'manual'; await saveVenue(v); location.hash = `/venues/${v.id}?tab=blueprint&quick=1`; });

  async function render() {
    let list = [];
    try { list = await listVenues(); } catch (e) { $('[data-list]').innerHTML = `<div class="callout red">${icon('warning')}<span>Browser storage (IndexedDB) is unavailable: ${esc(e.message)}</span></div>`; return; }
    $('[data-n]').textContent = `${list.length} saved in this browser`;
    if (!list.length) { $('[data-list]').innerHTML = `<div class="empty-state card">${icon('building')}<h3>No venues yet</h3><p class="muted">Pick a method above to create your first digital venue.</p></div>`; return; }
    $('[data-list]').innerHTML = list.map((v) => `
      <article class="vc card" data-id="${v.id}">
        <a class="vc-thumb" href="#/venues/${v.id}"><canvas></canvas></a>
        <div class="vc-body">
          <input class="vc-name" value="${esc(v.name)}" aria-label="Venue name">
          <p class="faint small">${v.plan.shapes.length} elements · ${v.config.population.total} people · ${v.runs.length} run${v.runs.length === 1 ? '' : 's'} · updated ${new Date(v.updatedAt).toLocaleString()}</p>
          <div class="row gap8 wrap-row">
            <a class="btn sm primary" href="#/venues/${v.id}">${icon('edit')}Open</a>
            <button class="btn sm" data-dup>${icon('compare')}Duplicate</button>
            <button class="btn sm ghost icon" data-del aria-label="Delete ${esc(v.name)}">${icon('trash')}</button>
          </div>
        </div>
      </article>`).join('');
    root.querySelectorAll('.vc').forEach((el) => {
      const v = list.find((x) => x.id === el.dataset.id);
      try { if (v.plan.shapes.length) renderStaticPlan(el.querySelector('canvas'), rasterize(v), { pad: 4, labels: false, openingLabels: false }); } catch { /* empty venue */ }
      el.querySelector('.vc-name').addEventListener('change', async (e) => { v.name = e.target.value.trim() || v.name; v.config.details.name = v.name; await saveVenue(v); toast('Renamed', 'ok', 1200); });
      el.querySelector('[data-dup]').addEventListener('click', async () => { await duplicateVenue(v); toast('Venue duplicated', 'ok'); render(); });
      el.querySelector('[data-del]').addEventListener('click', () => {
        const m = openModal({ title: 'Delete venue?', body: `<div class="pad stack"><p class="muted">“${esc(v.name)}”, its photos, plans, scenarios and run history will be removed from this browser. This cannot be undone.</p><div class="row gap8"><button class="btn" data-close>Cancel</button><button class="btn danger" data-ok>${icon('trash')}Delete</button></div></div>` });
        m.body.querySelector('[data-ok]').addEventListener('click', async () => { m.close(); await deleteVenue(v.id); toast('Venue deleted', 'ok'); render(); });
      });
    });
  }
  render();
}
