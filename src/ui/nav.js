import { icon, logoMark } from './icons.js';
import { currentUser, signOut } from '../auth/auth.js';
import { esc } from './dom.js';

const ITEMS = [
  { path: '/', label: 'Overview', icon: 'overview' },
  { path: '/simulator', label: 'Simulator', icon: 'simulator' },
  { path: '/3d', label: '3D View', icon: 'cube' },
  { path: '/venues', label: 'Venues', icon: 'building' },
  { path: '/how-it-works', label: 'How It Works', icon: 'flow' },
  { path: '/technology', label: 'Technology', icon: 'chip' },
  { path: '/learn', label: 'Learn', icon: 'learn' },
  { path: '/reports', label: 'Reports', icon: 'report' },
];

let host;
export function renderNav(h) {
  host = h;
  host.className = 'topnav';
  host.innerHTML = `
    <a class="brand" href="#/" aria-label="EvacPrint home">${logoMark(28)}<span>EvacPrint</span></a>
    <nav class="nav-links" aria-label="Primary">
      ${ITEMS.map((i) => `<a href="#${i.path}" data-path="${i.path}">${icon(i.icon)}<span>${i.label}</span></a>`).join('')}
    </nav>
    <div class="nav-right"></div>
    <button class="btn ghost icon nav-burger" aria-label="Open menu" aria-expanded="false">${icon('menu')}</button>`;
  const burger = host.querySelector('.nav-burger');
  burger.addEventListener('click', () => {
    const open = host.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('.nav-links a')) host.classList.remove('open');
    const menuBtn = e.target.closest('[data-usermenu]');
    if (menuBtn) {
      const m = host.querySelector('.user-menu');
      const open = m.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
      e.stopPropagation();
    }
    if (e.target.closest('[data-signout]')) { signOut(); location.hash = '/'; }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) host.querySelector('.user-menu')?.classList.remove('open');
  });
  updateNav('/');
}

export function updateNav(path) {
  if (!host) return;
  host.querySelectorAll('.nav-links a').forEach((a) => {
    const p = a.dataset.path;
    const active = p === '/' ? path === '/' : path?.startsWith(p);
    a.classList.toggle('active', !!active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const u = currentUser();
  const right = host.querySelector('.nav-right');
  if (!u) {
    right.innerHTML = `<a class="btn ghost sm" href="#/login">Sign in</a><a class="btn primary sm" href="#/login?demo=1">${icon('play')}Try demo</a>`;
    return;
  }
  const initials = u.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  right.innerHTML = `
    <div class="user-menu">
      <button class="user-btn" data-usermenu aria-haspopup="menu" aria-expanded="false">
        <span class="avatar">${esc(initials)}</span>
        <span class="user-name">${esc(u.name)}</span>
        ${u.demo ? '<span class="tag-demo">demo</span>' : ''}
        ${icon('chevronDown')}
      </button>
      <div class="menu" role="menu">
        <div class="menu-head"><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span></div>
        <a role="menuitem" href="#/profile">${icon('user')}Profile</a>
        <a role="menuitem" href="#/reports">${icon('report')}Saved reports</a>
        <button role="menuitem" data-signout>${icon('logout')}Sign out</button>
      </div>
    </div>`;
}
