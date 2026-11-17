// Demo authentication (local-only).
//
// EvacPrint's prototype has no backend, so accounts live in this browser's
// localStorage. Passwords are never stored: we keep a PBKDF2-SHA-256 hash
// (210 000 iterations, 16-byte random salt) computed with WebCrypto. Recovery
// works through a one-time recovery code shown at registration (also stored
// only as a hash), because a local prototype cannot send e-mail.
//
// This is clearly labelled in the UI as demo authentication: anyone with
// access to this browser profile can read or clear localStorage, so it is
// NOT production-grade account security.

const USERS = 'ep.users.v1';
const SESSION = 'ep.session.v1';
const ATTEMPTS = 'ep.attempts.v1';
const ITER = 210000;
export const DEMO_EMAIL = 'demo@evacprint.local';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hash(secret, saltB64, iterations = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations }, key, 256);
  return b64(bits);
}
const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));
const timingSafeEq = (a, b) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const users = () => read(USERS, {});
const norm = (e) => String(e || '').trim().toLowerCase();

export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());
export function passwordIssues(p) {
  const out = [];
  if (p.length < 8) out.push('at least 8 characters');
  if (!/[A-Za-z]/.test(p)) out.push('a letter');
  if (!/\d/.test(p)) out.push('a number');
  return out;
}
export function passwordStrength(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

function recoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(r, (v) => alphabet[v % alphabet.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

// ------------------------------------------------------------------ session
let current = null;
const listeners = new Set();
export const onAuthChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn(current));

export function restoreSession() {
  const s = read(SESSION, null) || (() => { try { return JSON.parse(sessionStorage.getItem(SESSION)); } catch { return null; } })();
  if (s && s.expires > Date.now()) {
    const u = users()[s.email];
    if (u) current = publicUser(u);
  }
  return current;
}
export const currentUser = () => current;

function publicUser(u) {
  return { email: u.email, name: u.name, org: u.org || '', role: u.role || '', venue: u.venue || '', demo: !!u.demo, createdAt: u.createdAt, onboarded: !!u.onboarded };
}

function startSession(u, remember) {
  const s = { email: u.email, expires: Date.now() + (remember ? 30 : 1) * 24 * 3600 * 1000 };
  try {
    localStorage.removeItem(SESSION);
    sessionStorage.removeItem(SESSION);
    (remember ? localStorage : sessionStorage).setItem(SESSION, JSON.stringify(s));
  } catch { /* ignore */ }
  current = publicUser(u);
  emit();
}

export function signOut() {
  try { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); } catch { /* ignore */ }
  current = null;
  emit();
}

// ------------------------------------------------------------------ actions
export async function register({ name, email, password, org = '', role = '' }) {
  const e = norm(email);
  if (!name.trim()) throw new Error('Enter your name.');
  if (!validEmail(e)) throw new Error('Enter a valid e-mail address.');
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(`Password needs ${issues.join(', ')}.`);
  const all = users();
  if (all[e]) throw new Error('An account with this e-mail already exists in this browser.');
  const salt = newSalt();
  const code = recoveryCode();
  const rSalt = newSalt();
  all[e] = {
    email: e, name: name.trim(), org: org.trim(), role,
    salt, hash: await hash(password, salt), iter: ITER,
    rSalt, rHash: await hash(code.replace(/-/g, ''), rSalt),
    createdAt: Date.now(), onboarded: false,
  };
  write(USERS, all);
  startSession(all[e], true);
  return { recoveryCode: code };
}

function lockState(e) {
  const a = read(ATTEMPTS, {});
  return a[e] || { n: 0, until: 0 };
}
function recordFail(e) {
  const a = read(ATTEMPTS, {});
  const s = a[e] || { n: 0, until: 0 };
  s.n++;
  if (s.n >= 5) { s.until = Date.now() + 30000; s.n = 0; }
  a[e] = s;
  write(ATTEMPTS, a);
}
function clearFails(e) { const a = read(ATTEMPTS, {}); delete a[e]; write(ATTEMPTS, a); }

export async function signIn({ email, password, remember }) {
  const e = norm(email);
  if (!validEmail(e)) throw Object.assign(new Error('Enter a valid e-mail address.'), { field: 'email' });
  if (!password) throw Object.assign(new Error('Enter your password.'), { field: 'password' });
  const lock = lockState(e);
  if (lock.until > Date.now()) {
    const s = Math.ceil((lock.until - Date.now()) / 1000);
    throw new Error(`Too many attempts. Try again in ${s} s.`);
  }
  const u = users()[e];
  // Hash even when the account is missing so timing does not reveal which e-mails exist.
  const h = await hash(password, u ? u.salt : 'AAAAAAAAAAAAAAAAAAAAAA==', u ? u.iter : ITER);
  if (!u || u.demo || !timingSafeEq(h, u.hash)) {
    recordFail(e);
    throw new Error('E-mail or password is incorrect.');
  }
  clearFails(e);
  startSession(u, remember);
  return current;
}

export function enterDemo() {
  const all = users();
  if (!all[DEMO_EMAIL]) {
    all[DEMO_EMAIL] = { email: DEMO_EMAIL, name: 'Demo Judge', org: 'RoboForge Hackathon', role: 'Evaluator', demo: true, createdAt: Date.now(), onboarded: false };
    write(USERS, all);
  }
  startSession(all[DEMO_EMAIL], false);
  return current;
}

export async function resetWithCode({ email, code, password }) {
  const e = norm(email);
  const u = users()[e];
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!validEmail(e)) throw Object.assign(new Error('Enter a valid e-mail address.'), { field: 'email' });
  if (clean.length !== 12) throw Object.assign(new Error('Recovery codes have 12 characters (XXXX-XXXX-XXXX).'), { field: 'code' });
  const issues = passwordIssues(password);
  if (issues.length) throw Object.assign(new Error(`Password needs ${issues.join(', ')}.`), { field: 'password' });
  const h = u && !u.demo ? await hash(clean, u.rSalt) : '';
  if (!u || u.demo || !timingSafeEq(h, u.rHash)) throw new Error('That e-mail and recovery code do not match an account in this browser.');
  const all = users();
  all[e].salt = newSalt();
  all[e].hash = await hash(password, all[e].salt);
  // rotate the recovery code: the old one is single-use
  const next = recoveryCode();
  all[e].rSalt = newSalt();
  all[e].rHash = await hash(next.replace(/-/g, ''), all[e].rSalt);
  write(USERS, all);
  return { recoveryCode: next };
}

export function updateProfile(patch) {
  if (!current) return;
  const all = users();
  const u = all[current.email];
  if (!u) return;
  for (const k of ['name', 'org', 'role', 'venue', 'onboarded']) if (k in patch) u[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
  write(USERS, all);
  current = publicUser(u);
  emit();
}

export async function changePassword(oldP, newP) {
  const all = users();
  const u = all[current?.email];
  if (!u || u.demo) throw new Error('The demo account has no password.');
  if (!timingSafeEq(await hash(oldP, u.salt, u.iter), u.hash)) throw Object.assign(new Error('Current password is incorrect.'), { field: 'old' });
  const issues = passwordIssues(newP);
  if (issues.length) throw Object.assign(new Error(`New password needs ${issues.join(', ')}.`), { field: 'new' });
  u.salt = newSalt();
  u.hash = await hash(newP, u.salt);
  u.iter = ITER;
  write(USERS, all);
}

export function deleteAccount() {
  if (!current) return;
  const all = users();
  delete all[current.email];
  write(USERS, all);
  try { localStorage.removeItem(`ep.reports.${current.email}`); } catch { /* ignore */ }
  signOut();
}
