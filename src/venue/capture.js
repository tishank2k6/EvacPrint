// Smart Venue Capture tab: camera, image/video upload, floor-plan import.
import { icon } from '../ui/icons.js';
import { esc, toast } from '../ui/dom.js';
import { putMedia, listMedia, deleteMedia, saveVenue } from './store.js';
import { uid, newShape } from './model.js';
import { classify, imageFile, videoFrames, pdfFile, svgFile, readFile, parseDXF, dxfToWalls, canvasToBlob, IMAGE_TYPES, MAX_IMAGE, MAX_VIDEO } from './importers.js';
import { aiStatus, aiBlueprint } from '../assistant/api.js';
import { blobToBase64 } from './importers.js';
import { openQuickBuilder } from './quickbuild.js';

export const SHOTS = [
  ['overview', 'Room overview', 'Stand in a corner and capture the whole room.'],
  ['opposite', 'Opposite corner', 'Repeat from the diagonally opposite corner.'],
  ['entrance', 'Entrances', 'Each way in, with the door frame visible.'],
  ['exit', 'Emergency exits', 'Every exit door and its signage.'],
  ['corridor', 'Corridors', 'Look along each corridor leading out.'],
  ['obstacle', 'Obstacles', 'Furniture, steps, pillars or stored items near routes.'],
];
const TAGS = Object.fromEntries(SHOTS.map(([k, l]) => [k, l]));

// photos sent to the AI first: the ones that show the whole room and its exits
const TAG_ORDER = ['overview', 'opposite', 'exit', 'entrance', 'corridor', 'obstacle', 'other'];
const MAX_AI_IMAGES = 4; // the server accepts at most 4 images per draft

export function mountCapture(host, venue, { method = 'camera', onPlan, onChange, onShapes, onTab } = {}) {
  let stream = null;
  let urls = [];
  const state = { method, busy: false, aiW: '', aiH: '', aiOut: '' };
  host.innerHTML = `
    <div class="cap">
      <div class="cap-methods seg" role="tablist" aria-label="Capture method">
        <button role="tab" data-m="camera">${icon('camera')}Camera</button>
        <button role="tab" data-m="upload">${icon('download')}Images or video</button>
        <button role="tab" data-m="plan">${icon('plan')}Floor plan</button>
      </div>
      <div class="cap-body"></div>
      <section class="ai-box" data-aibox aria-live="polite"></section>
      <section class="qb-box">
        <div>${icon('edit')}<b>No AI? Build it from measurements</b></div>
        <p class="small muted">Photos alone cannot be measured, so without AI EvacPrint builds the model from sizes you type in: room width and depth, stage, seating and exits per wall. You get the full blueprint and 3D model in one step, and can refine it on the Blueprint tab.</p>
        <div class="row gap8 wrap-row"><button class="btn sm primary" data-quick>${icon('cube')}Quick room builder</button><button class="btn sm ghost" data-draw>${icon('plan')}Draw it myself</button></div>
      </section>
      <section class="cap-gallery">
        <div class="row between"><div class="mini-h">Captured media</div><span class="faint small" data-count></span></div>
        <div class="gal" data-gal></div>
      </section>
    </div>`;
  const body = host.querySelector('.cap-body');
  let alive = true; // async work may finish after the tab was switched
  host.querySelector('[data-quick]').addEventListener('click', () => openQuickBuilder(venue, {
    onBuilt: async (r) => { await saveVenue(venue); onChange?.(); toast(`Built ${r.W} × ${r.D} m room: ${r.validation.capacity.seats} seats, ${r.shapes.filter((x) => x.type === 'exit').length} exits`, 'ok'); onTab?.('3d'); },
  }));
  host.querySelector('[data-draw]').addEventListener('click', () => onTab?.('blueprint'));

  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const cleanupUrls = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };

  async function gallery() {
    cleanupUrls();
    const media = await listMedia(venue.id);
    if (!alive) return;
    renderAI(media);
    host.querySelector('[data-count]').textContent = `${media.length} item${media.length === 1 ? '' : 's'} · stored in this browser`;
    const g = host.querySelector('[data-gal]');
    if (!media.length) { g.innerHTML = '<p class="faint small">Nothing captured yet. Photos and plans are references for drawing the blueprint; only a calibrated floor plan sets real dimensions.</p>'; return; }
    g.innerHTML = media.map((m) => {
      const u = URL.createObjectURL(m.blob); urls.push(u);
      const isBg = venue.plan.background?.mediaId === m.id;
      return `<figure class="gi ${isBg ? 'bg' : ''}" data-id="${m.id}">
        <img src="${u}" alt="${esc(m.name)}" loading="lazy">
        <figcaption>
          <span class="chip ${m.kind === 'plan' ? 'teal' : ''}">${m.kind === 'plan' ? 'Floor plan' : m.kind === 'frame' ? `Video frame ${m.t?.toFixed(1)} s` : esc(TAGS[m.tag] || 'Photo')}</span>
          <div class="row gap8">
            ${m.kind !== 'plan' ? `<select class="input sm-in" data-tag aria-label="Photo category">${SHOTS.map(([k, l]) => `<option value="${k}" ${m.tag === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="other" ${m.tag === 'other' ? 'selected' : ''}>Other</option></select>` : ''}
            <button class="btn sm" data-usebg title="Show behind the blueprint">${icon('plan')}${isBg ? 'Background' : 'Use as background'}</button>
            ${m.kind === 'photo' ? `<button class="btn sm ghost" data-retake title="Delete and capture again">${icon('camera')}Retake</button>` : ''}
            <button class="btn sm ghost icon" data-del aria-label="Delete ${esc(m.name)}">${icon('trash')}</button>
          </div>
        </figcaption></figure>`;
    }).join('');
    g.querySelectorAll('.gi').forEach((fig) => {
      const id = fig.dataset.id;
      const m = media.find((x) => x.id === id);
      fig.querySelector('[data-del]').addEventListener('click', async () => {
        await deleteMedia(id);
        if (venue.plan.background?.mediaId === id) { venue.plan.background = null; await saveVenue(venue); onPlan?.(); }
        toast('Deleted', 'ok', 1200); gallery();
      });
      fig.querySelector('[data-tag]')?.addEventListener('change', async (e) => { m.tag = e.target.value; await putMedia(m); renderAI(media); });
      fig.querySelector('[data-retake]')?.addEventListener('click', async () => { await deleteMedia(id); switchTo('camera', m.tag); gallery(); });
      fig.querySelector('[data-usebg]').addEventListener('click', async () => {
        venue.plan.background = { mediaId: id, mPerPx: venue.plan.background?.mPerPx || 0.02, x: 0, y: 0, opacity: 0.55, calibrated: false };
        await saveVenue(venue);
        onPlan?.({ calibrate: true });
      });
    });
  }

  async function addMedia(blobInfo, extra) {
    const m = { id: uid('m'), venueId: venue.id, createdAt: Date.now(), blob: blobInfo.blob, w: blobInfo.w, h: blobInfo.h, ...extra };
    await putMedia(m);
    if (!venue.source.media.includes(m.id)) venue.source.media.push(m.id);
    venue.source.method = extra.kind === 'plan' ? 'plan' : extra.kind === 'photo' ? 'camera' : 'upload';
    await saveVenue(venue);
    onChange?.();
    return m;
  }

  // ------------------------------------------------------------- camera
  async function cameraView(tag = 'overview') {
    const supported = !!navigator.mediaDevices?.getUserMedia;
    body.innerHTML = `
      <div class="cam">
        <div class="cam-stage">
          <video playsinline muted></video>
          <div class="cam-off">${supported ? `${icon('camera')}<p>The camera only starts after you press <b>Start camera</b> and allow access.</p><button class="btn primary" data-start>${icon('camera')}Start camera</button>` : `${icon('warning')}<p>This browser does not expose a camera (it needs HTTPS or localhost and a camera device). Use <b>Images or video</b> instead.</p>`}</div>
          <div class="cam-guide"><span></span></div>
        </div>
        <aside class="cam-side">
          <div class="mini-h">Capture checklist</div>
          <ol class="shots">${SHOTS.map(([k, l, d]) => `<li><label><input type="radio" name="shot" value="${k}" ${k === tag ? 'checked' : ''}><span><b>${l}</b><em>${d}</em></span></label></li>`).join('')}</ol>
          <div class="field"><label>Camera</label><select class="input" data-dev disabled><option>—</option></select></div>
          <button class="btn amber wide" data-snap disabled>${icon('camera')}Capture photo</button>
          <button class="btn ghost wide" data-stop disabled>Stop camera</button>
          <p class="faint small">Photos are stored only in this browser. They help you and the AI draft the layout; they do not measure it.</p>
        </aside>
      </div>`;
    const video = body.querySelector('video');
    const start = async (deviceId) => {
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        video.srcObject = stream;
        await video.play();
        body.querySelector('.cam-off').hidden = true;
        body.querySelector('[data-snap]').disabled = false;
        body.querySelector('[data-stop]').disabled = false;
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        const sel = body.querySelector('[data-dev]');
        sel.innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || `Camera ${i + 1}`)}</option>`).join('');
        sel.disabled = devs.length < 2;
        const cur = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (cur) sel.value = cur;
      } catch (e) {
        const denied = e.name === 'NotAllowedError';
        body.querySelector('.cam-off').innerHTML = `${icon('warning')}<p>${denied ? 'Camera permission was denied. Allow it in the browser’s site settings, or upload photos instead.' : `Could not start the camera: ${esc(e.message)}`}</p><button class="btn" data-start>Try again</button>`;
        body.querySelector('[data-start]').addEventListener('click', () => start());
      }
    };
    body.querySelector('[data-start]')?.addEventListener('click', () => start());
    body.querySelector('[data-dev]').addEventListener('change', (e) => start(e.target.value));
    body.querySelector('[data-stop]').addEventListener('click', () => { stop(); cameraView(currentTag()); });
    const currentTag = () => body.querySelector('input[name="shot"]:checked')?.value || 'overview';
    body.querySelector('[data-snap]').addEventListener('click', async () => {
      if (!stream) return;
      const tagNow = currentTag();
      const shot = await canvasToBlob(video, 2000);
      body.querySelector('.cam-stage').classList.add('flash');
      setTimeout(() => body.querySelector('.cam-stage')?.classList.remove('flash'), 220);
      await addMedia(shot, { kind: 'photo', tag: tagNow, name: `${TAGS[tagNow]} ${new Date().toLocaleTimeString()}` });
      // advance the checklist
      const radios = [...body.querySelectorAll('input[name="shot"]')];
      const k = radios.findIndex((r) => r.checked);
      if (k >= 0 && k < radios.length - 1) radios[k + 1].checked = true;
      toast(`Captured: ${TAGS[tagNow]}`, 'ok', 1400);
      gallery();
    });
  }

  // ------------------------------------------------------------- uploads
  function uploadView() {
    body.innerHTML = `
      <label class="drop" data-drop>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" hidden>
        ${icon('download')}<b>Drop photos or a walkthrough video here</b><span>JPG, JPEG, PNG, WEBP (≤ 25 MB each) · MP4 / WebM video (≤ 250 MB) — 8 representative frames are extracted</span>
        <span class="btn sm">Choose files</span>
      </label>
      <div class="up-list" data-list></div>`;
    wireDrop(body.querySelector('[data-drop]'), handleUploads);
  }
  async function handleUploads(files) {
    const list = body.querySelector('[data-list]');
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'up-row';
      row.innerHTML = `<span class="up-n">${esc(f.name)}</span><div class="progress"><i></i></div><span class="up-s faint small">waiting</span>`;
      list.prepend(row);
      const bar = row.querySelector('.progress i'), st = row.querySelector('.up-s');
      const prog = (p) => { bar.style.width = `${Math.round(p * 100)}%`; };
      try {
        const kind = classify(f);
        if (kind === 'image') {
          if (!IMAGE_TYPES.includes(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) throw new Error('Unsupported image type');
          if (f.size > MAX_IMAGE) throw new Error('Larger than 25 MB');
          st.textContent = 'reading';
          const img = await imageFile(f, prog);
          await addMedia(img, { kind: 'photo', tag: 'other', name: f.name });
          st.textContent = 'added';
        } else if (kind === 'video') {
          if (f.size > MAX_VIDEO) throw new Error('Larger than 250 MB');
          st.textContent = 'extracting frames';
          const { frames, duration } = await videoFrames(f, 8, prog);
          for (const fr of frames) await addMedia(fr, { kind: 'frame', tag: 'other', t: fr.t, name: `${f.name} @ ${fr.t.toFixed(1)} s` });
          st.textContent = `${frames.length} frames from ${duration.toFixed(0)} s`;
        } else throw new Error('Not an image or video — use the Floor plan tab for PDF, SVG or DXF');
        row.classList.add('ok');
      } catch (e) { row.classList.add('err'); st.textContent = e.message; }
    }
    gallery();
  }

  // ------------------------------------------------------------- floor plans
  function planView() {
    body.innerHTML = `
      <div class="plan-imp">
        <label class="drop" data-drop>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.dxf,.dwg,application/pdf,image/*" hidden>
          ${icon('plan')}<b>Drop an existing floor plan</b><span>PDF (first page) · PNG · JPG · WEBP · SVG · DXF (lines, polylines, arcs). DWG must be exported to DXF or PDF first.</span>
          <span class="btn sm">Choose file</span>
        </label>
        <div class="up-list" data-list></div>
        <div class="plan-next card pad">
          <div class="mini-h">After importing</div>
          <ol class="steps-ol">
            <li><b>Calibrate</b> — on the Blueprint tab pick two points on a wall and type its real length (e.g. 12 m).</li>
            <li><b>Trace walls</b> — automatic threshold tracing of dark lines on the calibrated plan; check and correct the result.</li>
            <li><b>Add openings</b> — place doors and emergency exits; tracing cannot tell a doorway from a gap.</li>
            <li>Or use <b>Build the blueprint with AI</b> below for an editable first draft.</li>
          </ol>
        </div>
      </div>`;
    wireDrop(body.querySelector('[data-drop]'), handlePlan);
  }
  async function handlePlan(files) {
    const f = files[0];
    if (!f) return;
    const list = body.querySelector('[data-list]');
    const row = document.createElement('div');
    row.className = 'up-row';
    row.innerHTML = `<span class="up-n">${esc(f.name)}</span><div class="progress"><i></i></div><span class="up-s faint small">reading</span>`;
    list.prepend(row);
    const prog = (p) => { row.querySelector('.progress i').style.width = `${Math.round(p * 100)}%`; };
    const st = row.querySelector('.up-s');
    try {
      const kind = classify(f);
      if (kind === 'dwg') throw new Error('DWG is a proprietary binary format. Export it from your CAD tool as DXF or PDF, then import that.');
      if (kind === 'dxf') {
        const text = await readFile(f, 'text', prog);
        const dxf = parseDXF(text);
        let k = dxf.units;
        if (!k) {
          const span = Math.max(dxf.bounds.maxX - dxf.bounds.minX, dxf.bounds.maxY - dxf.bounds.minY);
          const guess = span > 2000 ? 0.001 : span > 200 ? 0.01 : 1;
          const ans = prompt(`This DXF does not state its units. Drawing span is ${span.toFixed(1)} units.\nMetres per drawing unit? (1 = metres, 0.01 = cm, 0.001 = mm)`, String(guess));
          k = +ans;
          if (!(k > 0)) throw new Error('Units are needed to scale the drawing.');
        }
        const walls = dxfToWalls(dxf, k);
        const W = (dxf.bounds.maxX - dxf.bounds.minX) * k + 2, H = (dxf.bounds.maxY - dxf.bounds.minY) * k + 2;
        if (W > 400 || H > 400) throw new Error(`Drawing is ${W.toFixed(0)} × ${H.toFixed(0)} m — too large for one simulation. Crop it in CAD to one floor area.`);
        venue.plan.width = Math.ceil(W + 1); venue.plan.height = Math.ceil(H + 1);
        onShapes?.([...walls, { type: 'floorplate', x: 0.25, y: 0.25, w: W + 0.5, h: H + 0.5, name: 'Imported floor', rot: 0 }]);
        venue.plan.scaleVerified = !!dxf.units;
        venue.source.method = 'plan';
        await saveVenue(venue);
        st.textContent = `${walls.length} wall segments imported${dxf.units ? '' : ' (units confirmed by you)'} — add doors and exits`;
        row.classList.add('ok');
        toast(`Imported ${walls.length} walls from DXF`, 'ok');
        return;
      }
      let img;
      if (kind === 'pdf') { st.textContent = 'rendering page 1'; img = await pdfFile(f, prog); }
      else if (kind === 'svg') img = await svgFile(f, prog);
      else if (kind === 'image') img = await imageFile(f, prog, 2400);
      else throw new Error('Unsupported file type');
      const m = await addMedia(img, { kind: 'plan', name: f.name, pages: img.pages });
      venue.plan.background = { mediaId: m.id, mPerPx: Math.min(venue.plan.width / img.w, venue.plan.height / img.h) * 0.9, x: 0.5, y: 0.5, opacity: 0.6, calibrated: false };
      await saveVenue(venue);
      st.textContent = `ready${img.pages > 1 ? ` (page 1 of ${img.pages})` : ''} — calibrate it on the Blueprint tab`;
      row.classList.add('ok');
      gallery();
      onPlan?.({ calibrate: true });
    } catch (e) { row.classList.add('err'); st.textContent = e.message; }
  }
  // ------------------------------------------------------------- AI draft (all capture methods)
  const aiBox = host.querySelector('[data-aibox]');
  const providerName = (ai) => (ai.provider === 'gemini' ? 'Gemini' : 'Claude');
  /** a floor plan wins over photos; photos are ordered so overview and exit shots go first */
  function aiSource(media) {
    const plan = media.find((m) => m.id === venue.plan.background?.mediaId && m.kind === 'plan') || media.find((m) => m.kind === 'plan');
    if (plan) return { plan, pics: [plan], total: 1 };
    const photos = media.filter((m) => m.kind !== 'plan');
    const rank = (m) => { const i = TAG_ORDER.indexOf(m.tag); return i < 0 ? TAG_ORDER.length : i; };
    const pics = [...photos].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt).slice(0, MAX_AI_IMAGES);
    return { plan: null, pics, total: photos.length };
  }
  async function renderAI(media) {
    if (state.busy) return;
    const ai = await aiStatus();
    if (state.busy || !alive) return;
    const { plan, pics, total } = aiSource(media);
    const calibrated = plan && venue.plan.background?.mediaId === plan.id && venue.plan.background?.calibrated;
    let what;
    if (!ai.configured) what = esc(`${ai.reason || ''} Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to .env.local and restart the server to enable AI drafting. Manual tracing and drawing on the Blueprint tab work without it.`);
    else if (!pics.length) what = 'Add photos, a walkthrough video or a floor plan above, then draft. The AI returns an editable layout — rooms, walls, doors, exits, seating and obstacles — that you check on the Blueprint tab.';
    else if (plan) what = `Sends the floor plan <b>${esc(plan.name)}</b> to ${providerName(ai)} through the EvacPrint server.${calibrated ? ' Its calibrated scale sets the real size.' : ' Enter the real width and depth if you know them; otherwise sizes are read from the drawing or estimated, and marked unverified.'}`;
    else what = `Sends ${pics.length} photo${pics.length === 1 ? '' : 's'}${total > pics.length ? ` (of ${total}: overview and exit shots first — set each photo’s category below)` : ''} to ${providerName(ai)} through the EvacPrint server. Photos cannot measure a room: enter the real width and depth if you know them, otherwise every size is an AI estimate marked unverified. Photos of different rooms are treated as one venue.`;
    const showSize = ai.configured && pics.length && !calibrated;
    aiBox.className = `ai-box ${ai.configured ? '' : 'off'}`;
    aiBox.innerHTML = `
      <div>${icon('sparkle')}<b>Build the blueprint with AI</b> <span class="chip ${ai.configured ? 'teal' : ''}">${ai.configured ? `${providerName(ai)} connected` : 'not configured'}</span></div>
      <p class="small muted">${what}</p>
      <div class="row gap8 wrap-row">
        <button class="btn sm amber" data-ai ${ai.configured && pics.length ? '' : 'disabled'}>${icon('sparkle')}Draft blueprint from ${plan ? 'floor plan' : 'photos'}</button>
        ${showSize ? `<input class="input sm-in" data-aiw type="number" min="2" max="300" step="0.5" placeholder="Width m (optional)" value="${esc(state.aiW)}" style="width:150px" aria-label="Real width in metres (optional)"><input class="input sm-in" data-aih type="number" min="2" max="300" step="0.5" placeholder="Depth m (optional)" value="${esc(state.aiH)}" style="width:150px" aria-label="Real depth in metres (optional)">` : ''}
      </div>
      <div data-aiout>${state.aiOut}</div>`;
  }
  aiBox.addEventListener('input', (e) => {
    if (e.target.matches('[data-aiw]')) state.aiW = e.target.value;
    if (e.target.matches('[data-aih]')) state.aiH = e.target.value;
  });
  aiBox.addEventListener('click', (e) => {
    if (e.target.closest('[data-ai]')) runAI();
    const go = e.target.closest('[data-go]');
    if (go) onTab?.(go.dataset.go);
  });

  async function runAI() {
    if (state.busy) return;
    const ai = await aiStatus();
    const out = aiBox.querySelector('[data-aiout]');
    const btn = aiBox.querySelector('[data-ai]');
    const media = await listMedia(venue.id);
    const { plan, pics } = aiSource(media);
    if (!pics.length) { out.innerHTML = '<p class="error-text">Add a floor plan or some photos first.</p>'; return; }
    const prev = venue.plan.shapes.filter((s) => s.aiDraft).length;
    if (prev && !confirm(`Replace the previous AI draft?\n\n${prev} element(s) marked “AI draft” will be removed (including any you edited). Elements you drew yourself are kept.`)) return;
    state.busy = true;
    btn.disabled = true;
    out.innerHTML = `<div class="row gap8 small"><span class="spinner"></span>Sending ${pics.length} image${pics.length === 1 ? '' : 's'} to ${providerName(ai)}… this usually takes 10–40 s.</div>`;
    try {
      const images = [];
      for (const p of pics) images.push({ media_type: p.blob.type || 'image/jpeg', data: await blobToBase64(p.blob) });
      const wM = +state.aiW || null, hM = +state.aiH || null;
      const bg = venue.plan.background;
      const known = plan && bg?.mediaId === plan.id && bg.calibrated ? { widthM: plan.w * bg.mPerPx, heightM: plan.h * bg.mPerPx } : { widthM: wM, heightM: hM };
      const labels = plan ? [] : pics.map((p) => TAGS[p.tag] || (p.kind === 'frame' ? 'Walkthrough video frame' : 'Photo'));
      const res = await aiBlueprint({ images, hint: plan ? 'floor-plan' : 'photos', labels, ...known });
      const shapes = res.shapes || [];
      if (!shapes.length) throw new Error('The model returned no usable geometry. Try clearer overview photos, or a floor plan.');
      if (prev) venue.plan.shapes = venue.plan.shapes.filter((s) => !s.aiDraft);
      venue.plan.width = Math.max(venue.plan.width, Math.ceil(res.widthM + 2));
      venue.plan.height = Math.max(venue.plan.height, Math.ceil(res.heightM + 2));
      venue.plan.unverified = [...new Set([...(venue.plan.unverified || []), ...(res.unverified || [])])];
      if (!known.widthM) venue.plan.scaleVerified = false;
      onShapes?.(shapes.map((s) => ({ ...s, aiDraft: true })));
      await saveVenue(venue);
      const counts = {};
      for (const s of shapes) counts[s.type] = (counts[s.type] || 0) + 1;
      const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ');
      const noExit = !shapes.some((s) => s.type === 'exit');
      state.aiOut = `<div class="callout amber">${icon('info')}<span><b>Draft added (${res.widthM.toFixed(1)} × ${res.heightM.toFixed(1)} m): ${esc(summary)}.</b> ${esc(res.notes || '')} Sizes ${known.widthM ? 'use your measurements' : 'are AI estimates — unverified'}.${noExit ? ' <b>No emergency exit was visible — add at least one on the Blueprint tab before simulating.</b>' : ''} Check every element before trusting results.</span></div>
        <div class="row gap8 wrap-row"><button class="btn sm primary" data-go="blueprint">${icon('plan')}Review blueprint</button><button class="btn sm" data-go="3d">${icon('cube')}View 3D model</button></div>`;
      out.innerHTML = state.aiOut;
      toast(`AI draft added: ${shapes.length} elements`, 'ok');
    } catch (e) {
      state.aiOut = '';
      out.innerHTML = `<div class="callout red">${icon('warning')}<span>AI drafting failed: ${esc(e.message)}</span></div>`;
    } finally {
      state.busy = false;
      if (btn.isConnected) btn.disabled = false;
    }
  }

  function wireDrop(zone, fn) {
    const input = zone.querySelector('input');
    input.addEventListener('change', () => { fn([...input.files]); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); fn([...e.dataTransfer.files]); });
  }

  function switchTo(m, tag) {
    stop();
    state.method = m;
    host.querySelectorAll('[data-m]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === m)));
    host.querySelectorAll('[data-m]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
    if (m === 'camera') cameraView(tag); else if (m === 'upload') uploadView(); else planView();
  }
  host.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.m)));
  switchTo(state.method === 'manual' ? 'camera' : state.method);
  gallery();
  void newShape;
  return () => { alive = false; stop(); cleanupUrls(); };
}
