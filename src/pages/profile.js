import { currentUser, updateProfile, changePassword, signOut, deleteAccount } from '../auth/auth.js';
import { listReports } from '../reports/store.js';
import { icon } from '../ui/icons.js';
import { esc, toast, openModal } from '../ui/dom.js';

export function mount(root) {
  const u = currentUser();
  const reps = listReports();
  const initials = u.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  root.innerHTML = `
  <div class="wrap narrow">
    <header class="page-head">
      <span class="eyebrow">Profile</span>
      <div class="prof-id"><span class="avatar xl">${esc(initials)}</span><div><h1>${esc(u.name)}</h1><p class="muted">${esc(u.email)} ${u.demo ? '<span class="tag-demo">demo workspace</span>' : ''}</p></div></div>
    </header>
    <div class="prof-grid">
      <section class="card pad">
        <h3 class="sec-t">${icon('user')}Details</h3>
        <form data-details class="stack">
          <div class="field"><label for="p-name">Full name</label><input class="input" id="p-name" value="${esc(u.name)}" /></div>
          <div class="field"><label for="p-org">Organisation</label><input class="input" id="p-org" value="${esc(u.org)}" /></div>
          <div class="field"><label for="p-role">Role</label><input class="input" id="p-role" value="${esc(u.role)}" /></div>
          <div class="field"><label for="p-venue">Venue you manage</label><input class="input" id="p-venue" value="${esc(u.venue)}" placeholder="e.g. Seminar Hall 406, MSIT" /></div>
          <button class="btn primary" type="submit">${icon('check')}Save changes</button>
        </form>
      </section>
      <section class="stack">
        <div class="card pad">
          <h3 class="sec-t">${icon('report')}Workspace</h3>
          <div class="prof-stats">
            <div><b class="mono">${reps.length}</b><span>saved reports</span></div>
            <div><b class="mono">${new Date(u.createdAt).toLocaleDateString()}</b><span>member since</span></div>
          </div>
          <a class="btn wide" href="#/reports">${icon('report')}Open reports</a>
        </div>
        <div class="card pad">
          <h3 class="sec-t">${icon('lock')}Security</h3>
          ${u.demo
            ? `<p class="muted small">The demo workspace has no password. Create your own account to keep reports under your name.</p><a class="btn wide" href="#/register">Create an account</a>`
            : `<form data-pw class="stack">
                <div class="field"><label for="pw-old">Current password</label><input class="input" type="password" id="pw-old" autocomplete="current-password" /><div class="error-text" data-err="old"></div></div>
                <div class="field"><label for="pw-new">New password</label><input class="input" type="password" id="pw-new" autocomplete="new-password" /><div class="error-text" data-err="new"></div></div>
                <button class="btn" type="submit">${icon('key')}Change password</button>
              </form>`}
          <div class="callout amber mt">${icon('info')}<span><b>Demo authentication.</b> Your account and reports are stored in this browser only, with a PBKDF2-hashed password. It is not production-grade security and does not sync between devices.</span></div>
        </div>
        <div class="card pad">
          <h3 class="sec-t">${icon('logout')}Session</h3>
          <div class="row gap8 wrap-row"><button class="btn" data-out>${icon('logout')}Sign out</button><button class="btn danger" data-del>${icon('trash')}Delete local account</button></div>
        </div>
      </section>
    </div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  $('[data-details]').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#p-name').value.trim();
    if (!name) { toast('Name cannot be empty', 'warn'); return; }
    updateProfile({ name, org: $('#p-org').value, role: $('#p-role').value, venue: $('#p-venue').value });
    toast('Profile saved', 'ok');
  });
  $('[data-pw]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    root.querySelectorAll('[data-err]').forEach((x) => (x.textContent = ''));
    try {
      await changePassword($('#pw-old').value, $('#pw-new').value);
      $('#pw-old').value = $('#pw-new').value = '';
      toast('Password changed', 'ok');
    } catch (err) {
      const t = $(`[data-err="${err.field || 'old'}"]`);
      t.innerHTML = `${icon('warning')}${esc(err.message)}`;
    }
  });
  $('[data-out]').addEventListener('click', () => { signOut(); location.hash = '/'; toast('Signed out', 'ok'); });
  $('[data-del]').addEventListener('click', () => {
    const m = openModal({ title: 'Delete local account?', body: `<div class="pad stack"><p class="muted">This permanently removes <b>${esc(u.email)}</b> and its ${reps.length} saved report(s) from this browser. It cannot be undone.</p><div class="row gap8"><button class="btn" data-close>Cancel</button><button class="btn danger" data-confirm>${icon('trash')}Delete permanently</button></div></div>` });
    m.body.querySelector('[data-confirm]').addEventListener('click', () => { m.close(); deleteAccount(); location.hash = '/'; toast('Account deleted', 'ok'); });
  });
}
