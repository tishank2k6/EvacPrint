import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const fmtTime = (s) => {
  if (s == null || !isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${r.toFixed(1)} s`;
};
export const fmtSec = (s, d = 1) => (s == null || !isFinite(s) ? '—' : `${s.toFixed(d)} s`);

// ------------------------------------------------------------------ toasts
let toastHost;
export function toast(msg, kind = 'ok', ms = 3200) {
  if (!toastHost) {
    toastHost = el('<div class="toasts" role="status" aria-live="polite"></div>');
    document.body.appendChild(toastHost);
  }
  const ic = kind === 'ok' ? 'checkCircle' : kind === 'warn' ? 'warning' : kind === 'err' ? 'warning' : 'info';
  const t = el(`<div class="toast ${kind}">${icon(ic)}<span>${esc(msg)}</span></div>`);
  toastHost.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 240); }, ms);
}

// ------------------------------------------------------------------ tooltip
let tipEl;
export function showTip(html, x, y) {
  if (!tipEl) { tipEl = el('<div class="tip" role="tooltip"></div>'); document.body.appendChild(tipEl); }
  tipEl.innerHTML = html;
  const r = tipEl.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
  tipEl.classList.add('show');
}
export function hideTip() { tipEl?.classList.remove('show'); }

// ------------------------------------------------------------------ modal
export function openModal({ title, body, wide = false, onClose }) {
  const back = el(`<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal" style="${wide ? 'width:min(100%,1180px)' : ''}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body"></div>
    </div></div>`);
  const mb = back.querySelector('.modal-body');
  if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.appendChild(body);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  back.querySelector('[data-close]').focus();
  return { el: back, body: mb, close };
}

/** keep a range input's filled-track CSS variable in sync */
export function syncRange(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}

/** Render when an element first scrolls into view (lazy sections). */
export function onVisible(node, fn, rootMargin = '200px') {
  if (!('IntersectionObserver' in window)) { fn(); return () => {}; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin });
  io.observe(node);
  return () => io.disconnect();
}

/** Track visibility continuously (pause animations off-screen). */
export function watchVisible(node, cb) {
  if (!('IntersectionObserver' in window)) { cb(true); return () => {}; }
  const io = new IntersectionObserver((entries) => cb(entries[0].isIntersecting), { threshold: 0.01 });
  io.observe(node);
  return () => io.disconnect();
}
