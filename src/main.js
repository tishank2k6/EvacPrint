import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/venue.css';

import { restoreSession, currentUser, onAuthChange } from './auth/auth.js';
import { renderNav, updateNav } from './ui/nav.js';
import { reducedMotion } from './ui/dom.js';

const routes = [
  { path: '/', page: () => import('./pages/overview.js'), title: 'Overview' },
  { path: '/simulator', page: () => import('./pages/simulator.js'), title: 'Simulator', auth: true, full: true },
  { path: '/3d', page: () => import('./pages/view3dPage.js'), title: '3D View', auth: true, full: true },
  { path: '/venues', page: () => import('./pages/venues.js'), title: 'Venue Studio', auth: true },
  { path: '/venues/:id', page: () => import('./pages/venueEditor.js'), title: 'Venue Studio', auth: true, full: true },
  { path: '/how-it-works', page: () => import('./pages/howItWorks.js'), title: 'How It Works' },
  { path: '/technology', page: () => import('./pages/technology.js'), title: 'Technology' },
  { path: '/learn', page: () => import('./pages/learn.js'), title: 'Learn' },
  { path: '/reports', page: () => import('./pages/reports.js'), title: 'Reports', auth: true },
  { path: '/reports/:id', page: () => import('./pages/reports.js'), title: 'Report', auth: true },
  { path: '/profile', page: () => import('./pages/profile.js'), title: 'Profile', auth: true },
  { path: '/welcome', page: () => import('./pages/welcome.js'), title: 'Welcome', auth: true, bare: true },
  { path: '/login', page: () => import('./pages/auth.js'), title: 'Sign in', bare: true, mode: 'login' },
  { path: '/register', page: () => import('./pages/auth.js'), title: 'Create account', bare: true, mode: 'register' },
  { path: '/forgot', page: () => import('./pages/auth.js'), title: 'Recover access', bare: true, mode: 'forgot' },
];

function match(hash) {
  const [path, query = ''] = (hash.replace(/^#/, '') || '/').split('?');
  for (const r of routes) {
    const keys = [];
    const re = new RegExp('^' + r.path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    const m = path.match(re);
    if (m) {
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { route: r, params, query: new URLSearchParams(query), path };
    }
  }
  return null;
}

export const navigate = (to) => { if (location.hash !== `#${to}`) location.hash = to; };

const app = document.getElementById('app');
let cleanup = null;
let seq = 0;

async function render() {
  const my = ++seq;
  let m = match(location.hash);
  if (!m) { navigate('/'); return; }
  if (m.route.auth && !currentUser()) {
    navigate(`/login?next=${encodeURIComponent(m.path)}`);
    return;
  }
  if (['/login', '/register'].includes(m.route.path) && currentUser()) {
    navigate(m.query.get('next') || '/simulator');
    return;
  }
  const modP = m.route.page();
  const prev = app.querySelector('.page');
  if (prev && !reducedMotion()) {
    prev.classList.add('leaving');
    await new Promise((r) => setTimeout(r, 140));
  }
  const mod = await modP;
  if (my !== seq) return;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  document.body.classList.toggle('bare', !!m.route.bare);
  document.body.classList.toggle('full', !!m.route.full);
  updateNav(m.route.path);
  app.innerHTML = '';
  const page = document.createElement('main');
  page.className = `page page-${m.route.path.split('/')[1] || 'overview'}`;
  page.id = 'main';
  app.appendChild(page);
  document.title = `${m.route.title} · EvacPrint`;
  window.scrollTo(0, 0);
  cleanup = (await mod.mount(page, { ...m.params, query: m.query, mode: m.route.mode })) || null;
}

restoreSession();
renderNav(document.getElementById('nav'));
onAuthChange(() => {
  updateNav(match(location.hash)?.route.path);
  const m = match(location.hash);
  if (m?.route.auth && !currentUser()) navigate('/');
});
window.addEventListener('hashchange', render);
render();
// EvacPrint AI loads after the first page so it never delays it
setTimeout(() => import('./assistant/assistant.js').then((m) => m.mountAssistant()), 400);
