// Importers for Smart Venue Capture: images, video frames, PDF / SVG / raster
// floor plans, DXF line drawings, and threshold-based wall tracing.
// Everything here runs locally in the browser.
import { CELL } from './model.js';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PLAN_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
export const MAX_IMAGE = 25 * 1024 * 1024;
export const MAX_VIDEO = 250 * 1024 * 1024;

export function ext(name) { return (name.split('.').pop() || '').toLowerCase(); }

export function classify(file) {
  const e = ext(file.name);
  if (file.type === 'application/pdf' || e === 'pdf') return 'pdf';
  if (e === 'dxf') return 'dxf';
  if (e === 'dwg') return 'dwg';
  if (file.type === 'image/svg+xml' || e === 'svg') return 'svg';
  if (IMAGE_TYPES.includes(file.type) || ['jpg', 'jpeg', 'png', 'webp'].includes(e)) return 'image';
  if (file.type.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(e)) return 'video';
  return 'unknown';
}

/** Read a file with progress reporting (0–1). */
export function readFile(file, as = 'arrayBuffer', onProgress) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    r.onload = () => { onProgress?.(1); resolve(r.result); };
    r.onerror = () => reject(r.error || new Error('Could not read file'));
    if (as === 'text') r.readAsText(file); else if (as === 'dataURL') r.readAsDataURL(file); else r.readAsArrayBuffer(file);
  });
}

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image could not be decoded')); i.src = src; });

/** Canvas → blob, downscaled so its long edge is ≤ max px. */
export async function canvasToBlob(source, max = 2000, type = 'image/jpeg', q = 0.86) {
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  const k = Math.min(1, max / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
  const ctx = cv.getContext('2d');
  if (type === 'image/png') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.drawImage(source, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, type, q));
  return { blob, w: cv.width, h: cv.height };
}

export async function imageFile(file, onProgress, max = 2000) {
  if (file.size > MAX_IMAGE) throw new Error(`${file.name} is larger than 25 MB`);
  const url = await readFile(file, 'dataURL', onProgress);
  const img = await loadImg(url);
  return canvasToBlob(img, max, file.type === 'image/png' ? 'image/png' : 'image/jpeg');
}

export async function svgFile(file, onProgress) {
  const text = await readFile(file, 'text', onProgress);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  const img = await loadImg(url);
  const w = img.naturalWidth || 1600, h = img.naturalHeight || 1200;
  const k = 2400 / Math.max(w, h);
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return canvasToBlob(cv, 2400, 'image/png');
}

export async function pdfFile(file, onProgress) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const data = await readFile(file, 'arrayBuffer', (p) => onProgress?.(p * 0.5));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 2400 / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale });
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vp.width), height: Math.round(vp.height) });
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  onProgress?.(1);
  const out = await canvasToBlob(cv, 2400, 'image/png');
  return { ...out, pages: doc.numPages, pointsPerPx: 1 / scale };
}

/** Pick `n` representative frames spread through a video. */
export async function videoFrames(file, n = 8, onProgress) {
  if (file.size > MAX_VIDEO) throw new Error(`${file.name} is larger than 250 MB`);
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This browser cannot decode that video format')); });
    // WebM written by browser recorders has no duration header (Infinity):
    // seeking far past the end makes the browser scan and report the real one.
    if (!isFinite(v.duration)) {
      await new Promise((res) => {
        const t = setTimeout(res, 4000);
        v.ondurationchange = () => { if (isFinite(v.duration)) { clearTimeout(t); res(); } };
        v.currentTime = 1e7;
      });
      v.ondurationchange = null;
    }
    const dur = isFinite(v.duration) ? v.duration : 0;
    if (!dur) throw new Error('Video duration unavailable');
    const frames = [];
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n) * dur;
      await new Promise((res) => { v.onseeked = res; v.currentTime = t; });
      // 'seeked' can fire before the new frame is decoded; wait until it is presented
      await new Promise((res) => {
        const done = () => res();
        if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(done); setTimeout(done, 400); }
        else setTimeout(done, 120);
      });
      const f = await canvasToBlob(v, 1600);
      frames.push({ ...f, t });
      onProgress?.((k + 1) / n);
    }
    return { frames, duration: dur };
  } finally { URL.revokeObjectURL(url); }
}

// ---------------------------------------------------------------- DXF (ASCII)
const UNIT = { 0: null, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };

/** Minimal DXF reader: LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC. Returns segments in drawing units. */
export function parseDXF(text) {
  const raw = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i].trim(), raw[i + 1].trim()]);
  let units = null;
  const segs = [];
  let i = 0;
  const readEntity = () => {
    const props = [];
    i++;
    while (i < pairs.length && pairs[i][0] !== '0') { props.push(pairs[i]); i++; }
    return props;
  };
  // header units
  for (let k = 0; k < pairs.length - 1; k++) if (pairs[k][1] === '$INSUNITS') { units = UNIT[+pairs[k + 1][1]] ?? null; break; }
  let inEntities = false;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === '2' && val === 'ENTITIES') inEntities = true;
    if (code === '0' && val === 'ENDSEC') inEntities = false;
    if (inEntities && code === '0' && (val === 'LINE' || val === 'LWPOLYLINE' || val === 'ARC' || val === 'POLYLINE')) {
      const type = val;
      const p = readEntity();
      const g = (c) => p.filter((q) => q[0] === c).map((q) => +q[1]);
      if (type === 'LINE') segs.push([g('10')[0], g('20')[0], g('11')[0], g('21')[0]]);
      else if (type === 'LWPOLYLINE') {
        const xs = g('10'), ys = g('20');
        const closed = (g('70')[0] || 0) & 1;
        for (let k = 0; k + 1 < xs.length; k++) segs.push([xs[k], ys[k], xs[k + 1], ys[k + 1]]);
        if (closed && xs.length > 2) segs.push([xs.at(-1), ys.at(-1), xs[0], ys[0]]);
      } else if (type === 'ARC') {
        const [cx] = g('10'), [cy] = g('20'), [r] = g('40');
        let [a0] = g('50'), [a1] = g('51');
        if (a1 < a0) a1 += 360;
        const n = Math.max(4, Math.ceil((a1 - a0) / 15));
        for (let k = 0; k < n; k++) {
          const t0 = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180, t1 = ((a0 + ((a1 - a0) * (k + 1)) / n) * Math.PI) / 180;
          segs.push([cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)]);
        }
      } else if (type === 'POLYLINE') {
        const pts = [];
        while (i < pairs.length && !(pairs[i][0] === '0' && pairs[i][1] === 'SEQEND')) {
          if (pairs[i][0] === '0' && pairs[i][1] === 'VERTEX') { const v = readEntity(); const x = v.find((q) => q[0] === '10'), y = v.find((q) => q[0] === '20'); if (x && y) pts.push([+x[1], +y[1]]); } else i++;
        }
        for (let k = 0; k + 1 < pts.length; k++) segs.push([...pts[k], ...pts[k + 1]]);
      }
      continue;
    }
    i++;
  }
  const valid = segs.filter((s) => s.every((v) => isFinite(v)));
  if (!valid.length) throw new Error('No LINE / LWPOLYLINE / POLYLINE / ARC entities found in the DXF ENTITIES section.');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [a, b, c, d] of valid) { minX = Math.min(minX, a, c); maxX = Math.max(maxX, a, c); minY = Math.min(minY, b, d); maxY = Math.max(maxY, b, d); }
  return { segs: valid, units, bounds: { minX, minY, maxX, maxY } };
}

/** DXF segments → wall shapes in metres (DXF y-up → plan y-down), with a 1 m margin. */
export function dxfToWalls(dxf, metresPerUnit) {
  const { minX, maxY } = dxf.bounds;
  const k = metresPerUnit;
  return dxf.segs
    .filter(([a, b, c, d]) => Math.hypot(c - a, d - b) * k >= 0.2)
    .map(([a, b, c, d]) => ({ type: 'wall', x1: 1 + (a - minX) * k, y1: 1 + (maxY - b) * k, x2: 1 + (c - minX) * k, y2: 1 + (maxY - d) * k }));
}

// ---------------------------------------------------------------- raster tracing
/**
 * Threshold tracing of a calibrated plan image. Each 0.5 m cell becomes wall
 * when enough of its pixels are dark. Returns wall line shapes in metres.
 */
export function traceWalls(imgData, metresPerPx, { threshold = 110, fill = 0.22, offset = { x: 0, y: 0 } } = {}) {
  const { width: W, height: H, data } = imgData;
  const cellPx = CELL / metresPerPx;
  const gw = Math.floor(W / cellPx), gh = Math.floor(H / cellPx);
  const wall = new Uint8Array(gw * gh);
  const ink = new Float32Array(gw * gh);
  const kind = new Uint8Array(gw * gh); // 0 none, 1 vertical line, 2 horizontal line, 3 solid ink
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      // A cell is wall when enough of it is ink, OR when a dark line crosses it
      // from side to side (dark pixels on most rows or most columns). The second
      // test catches thin wall lines that straddle two cells.
      let dark = 0, tot = 0;
      const x0 = Math.floor(gx * cellPx), y0 = Math.floor(gy * cellPx), x1 = Math.floor((gx + 1) * cellPx), y1 = Math.floor((gy + 1) * cellPx);
      const rows = new Uint8Array(y1 - y0), cols = new Uint8Array(x1 - x0);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const o = (y * W + x) * 4;
          const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
          if (data[o + 3] > 40 && lum < threshold) { dark++; rows[y - y0] = 1; cols[x - x0] = 1; }
          tot++;
        }
      const rowCov = rows.reduce((s, v) => s + v, 0) / Math.max(1, rows.length);
      const colCov = cols.reduce((s, v) => s + v, 0) / Math.max(1, cols.length);
      // a line crossing the cell covers ~all rows (vertical line) or ~all columns (horizontal),
      // while staying narrow in the other direction
      const vLine = rowCov >= 0.85 && colCov <= 0.6, hLine = colCov >= 0.85 && rowCov <= 0.6;
      const k = gy * gw + gx;
      ink[k] = tot ? dark / tot : 0;
      kind[k] = tot && ink[k] >= fill ? 3 : vLine ? 1 : hLine ? 2 : 0;
      wall[k] = kind[k] ? 1 : 0;
    }
  // thin lines that straddle a cell boundary mark two neighbours: keep the inkier one
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const k = gy * gw + gx;
      if (kind[k] === 1 && gx + 1 < gw && kind[k + 1] === 1) { if (ink[k] >= ink[k + 1]) { wall[k + 1] = 0; kind[k + 1] = 0; } else { wall[k] = 0; kind[k] = 0; } }
      if (kind[k] === 2 && gy + 1 < gh && kind[k + gw] === 2) { if (ink[k] >= ink[k + gw]) { wall[k + gw] = 0; kind[k + gw] = 0; } else { wall[k] = 0; kind[k] = 0; } }
    }
  // merge into horizontal runs, then vertical runs for what is left
  const used = new Uint8Array(gw * gh);
  const shapes = [];
  const m = (v) => v * CELL;
  for (let y = 0; y < gh; y++) {
    let x = 0;
    while (x < gw) {
      if (!wall[y * gw + x]) { x++; continue; }
      let x1 = x;
      while (x1 + 1 < gw && wall[y * gw + x1 + 1]) x1++;
      if (x1 - x >= 1) { for (let k = x; k <= x1; k++) used[y * gw + k] = 1; shapes.push({ type: 'wall', x1: offset.x + m(x + 0.5), y1: offset.y + m(y + 0.5), x2: offset.x + m(x1 + 0.5), y2: offset.y + m(y + 0.5) }); }
      x = x1 + 1;
    }
  }
  for (let x = 0; x < gw; x++) {
    let y = 0;
    while (y < gh) {
      if (!wall[y * gw + x] || used[y * gw + x]) { y++; continue; }
      let y1 = y;
      while (y1 + 1 < gh && wall[(y1 + 1) * gw + x] && !used[(y1 + 1) * gw + x]) y1++;
      shapes.push({ type: 'wall', x1: offset.x + m(x + 0.5), y1: offset.y + m(y + 0.5), x2: offset.x + m(x + 0.5), y2: offset.y + m(y1 + 0.5) });
      y = y1 + 1;
    }
  }
  return { shapes, cells: wall.reduce((s, v) => s + v, 0), gw, gh };
}

export async function blobToImageData(blob, maxPx = 2400) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  return { data: ctx.getImageData(0, 0, cv.width, cv.height), scale: k };
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
