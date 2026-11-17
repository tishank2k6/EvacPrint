import { signIn, register, enterDemo, resetWithCode, validEmail, passwordIssues, passwordStrength, currentUser } from '../auth/auth.js';
import { icon, logoMark } from '../ui/icons.js';
import { esc, toast, watchVisible, reducedMotion } from '../ui/dom.js';
import { IsoLive, LoopDriver } from '../render/iso.js';
import { Simulation } from '../sim/engine.js';
import { createHall406 } from '../sim/layout.js';

const go = (to) => { location.hash = to; };

function art() {
  return `
  <div class="auth-art">
    <div class="auth-art-top">
      <span class="eyebrow">Live engine preview</span>
      <span class="mono faint" data-live>—</span>
    </div>
    <div class="auth-iso"></div>
    <div class="auth-art-copy">
      <h2>Test the evacuation<br/>before the emergency happens.</h2>
      <p>What you see is the real EvacPrint engine: 140 occupants leaving Seminar Hall 406, routed by Dijkstra distance fields and slowed by local crowd density.</p>
      <div class="auth-stats">
        <div><b class="mono" data-s-t>0.0 s</b><span>simulated time</span></div>
        <div><b class="mono" data-s-out>0</b><span>evacuated</span></div>
        <div><b class="mono" data-s-pk>0.00</b><span>peak p/m²</span></div>
      </div>
    </div>
  </div>`;
}

const demoNote = `<div class="demo-note">${icon('info')}<span><b>Demo authentication.</b> Accounts are stored only in this browser (localStorage) with PBKDF2-hashed passwords. Convenient for evaluation — not production account security.</span></div>`;

function pwField(id, label, auto) {
  return `<div class="field">
    <label for="${id}">${label}</label>
    <div class="input-wrap">
      <input class="input" id="${id}" type="password" autocomplete="${auto}" />
      <button type="button" class="btn ghost sm icon reveal" data-reveal="${id}" aria-label="Show password" aria-pressed="false">${icon('eye')}</button>
    </div>
    <div class="error-text" data-err="${id}" aria-live="polite"></div>
  </div>`;
}
const textField = (id, label, type, auto, ph = '') => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" type="${type}" autocomplete="${auto}" placeholder="${ph}" /><div class="error-text" data-err="${id}" aria-live="polite"></div></div>`;

const forms = {
  login: () => `
    <h1>Sign in</h1>
    <p class="muted">Welcome back. Continue to your simulations and saved reports.</p>
    <button class="btn lg demo-btn" type="button" data-demo>${icon('play')}<span><b>Enter the demo</b><em>One click — no registration, nothing to remember</em></span>${icon('arrowRight')}</button>
    <div class="or"><span>or sign in with an account</span></div>
    <form novalidate data-form>
      ${textField('email', 'E-mail', 'email', 'username', 'you@college.edu')}
      ${pwField('password', 'Password', 'current-password')}
      <div class="row between">
        <label class="check"><input type="checkbox" id="remember" checked /> Remember me for 30 days</label>
        <a href="#/forgot" class="small">Forgot password?</a>
      </div>
      <div class="form-error" data-formerr role="alert"></div>
      <button class="btn primary lg wide" type="submit">${icon('lock')}Sign in</button>
    </form>
    <p class="switch">New to EvacPrint? <a href="#/register">Create an account</a></p>`,
  register: () => `
    <h1>Create your account</h1>
    <p class="muted">Save scenarios and evacuation reports for your venue.</p>
    <form novalidate data-form>
      ${textField('name', 'Full name', 'text', 'name', 'Aarav Sharma')}
      ${textField('email', 'E-mail', 'email', 'email', 'you@college.edu')}
      <div class="grid2">
        ${textField('org', 'Organisation <span class="faint">(optional)</span>', 'text', 'organization', 'MSIT')}
        <div class="field"><label for="role">Role</label><select class="input" id="role"><option>Venue administrator</option><option>Fire-safety officer</option><option>Event organiser</option><option>Student / researcher</option><option>Other</option></select><div class="error-text"></div></div>
      </div>
      ${pwField('password', 'Password', 'new-password')}
      <div class="strength" data-strength><i></i><i></i><i></i><i></i><span></span></div>
      <div class="form-error" data-formerr role="alert"></div>
      <button class="btn primary lg wide" type="submit">${icon('check')}Create account</button>
    </form>
    <p class="switch">Already registered? <a href="#/login">Sign in</a> · or <button class="linkbtn" type="button" data-demo>enter the demo</button></p>`,
  forgot: () => `
    <h1>Recover access</h1>
    <p class="muted">This prototype runs without an e-mail server, so recovery uses the one-time <b>recovery code</b> shown when you created your account.</p>
    <form novalidate data-form>
      ${textField('email', 'E-mail', 'email', 'username', 'you@college.edu')}
      ${textField('code', 'Recovery code', 'text', 'one-time-code', 'XXXX-XXXX-XXXX')}
      ${pwField('password', 'New password', 'new-password')}
      <div class="form-error" data-formerr role="alert"></div>
      <button class="btn primary lg wide" type="submit">${icon('key')}Reset password</button>
    </form>
    <p class="switch"><a href="#/login">${icon('arrowLeft')}Back to sign in</a></p>`,
};

export function mount(root, { mode, query }) {
  root.innerHTML = `
  <div class="auth">
    <section class="auth-form">
      <a class="brand" href="#/">${logoMark(30)}<span>EvacPrint</span></a>
      <div class="auth-card" data-card>${forms[mode]()}</div>
      ${demoNote}
    </section>
    ${art()}
  </div>`;
  const $ = (s) => root.querySelector(s);
  const next = query?.get('next') || null;

  // live illustration: a private engine instance, looping
  const driver = new LoopDriver(() => new Simulation(createHall406(), { occupants: 140, reactionMin: 2, reactionMax: 14, seed: 1 + Math.floor(Math.random() * 9999), panic: 0.25 }), { speed: 1.8 });
  const iso = new IsoLive($('.auth-iso'), driver, { pad: 8 });
  const stopVis = watchVisible($('.auth-iso'), (v) => (driver.visible = v));
  if (reducedMotion()) { for (let i = 0; i < 300; i++) driver.sim.step(); driver.paused = true; iso.draw(); }
  let lastHud = 0;
  const unsubHud = driver.subscribe((t) => {
    const n = performance.now();
    if (t === 'frame' && n - lastHud < 200) return;
    lastHud = n;
    const s = driver.sim;
    $('[data-live]').textContent = `${s.done ? 'complete' : 'running'} · seed ${s.params.seed}`;
    $('[data-s-t]').textContent = `${s.t.toFixed(1)} s`;
    $('[data-s-out]').textContent = `${s.evacuated}/${s.N}`;
    $('[data-s-pk]').textContent = s.peak.value.toFixed(2);
  });

  // reveal password
  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reveal]');
    if (r) {
      const inp = $(`#${r.dataset.reveal}`);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      r.innerHTML = icon(show ? 'eyeOff' : 'eye');
      r.setAttribute('aria-pressed', String(show));
      r.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    }
    if (e.target.closest('[data-demo]')) {
      enterDemo();
      toast('Signed in to the demo workspace', 'ok');
      go(next || (currentUser().onboarded ? '/simulator' : '/welcome'));
    }
  });
  if (query?.get('demo') === '1') { setTimeout(() => $('[data-demo]')?.focus(), 50); }

  const setErr = (id, msg) => {
    const inp = $(`#${id}`);
    const e = $(`[data-err="${id}"]`);
    if (inp) inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (e) e.innerHTML = msg ? `${icon('warning')}${esc(msg)}` : '';
  };
  const formErr = (msg) => { $('[data-formerr]').innerHTML = msg ? `<div class="callout red">${icon('warning')}<span>${esc(msg)}</span></div>` : ''; };
  const busy = (on) => {
    const b = $('[data-form] button[type="submit"]');
    b.disabled = on;
    if (on) { b.dataset.html = b.innerHTML; b.innerHTML = `<span class="spinner"></span>Working…`; } else if (b.dataset.html) b.innerHTML = b.dataset.html;
  };

  const strength = $('[data-strength]');
  if (strength) {
    $('#password').addEventListener('input', (e) => {
      const v = e.target.value;
      const s = passwordStrength(v);
      strength.dataset.level = v ? s : '';
      strength.querySelector('span').textContent = v ? ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s] : '';
    });
  }
  root.querySelectorAll('.input').forEach((i) => i.addEventListener('input', () => { setErr(i.id, ''); formErr(''); }));

  $('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    formErr('');
    const v = (id) => $(`#${id}`)?.value ?? '';
    try {
      if (mode === 'login') {
        let bad = false;
        if (!validEmail(v('email'))) { setErr('email', 'Enter a valid e-mail address.'); bad = true; }
        if (!v('password')) { setErr('password', 'Enter your password.'); bad = true; }
        if (bad) return;
        busy(true);
        await signIn({ email: v('email'), password: v('password'), remember: $('#remember').checked });
        toast(`Welcome back, ${currentUser().name.split(' ')[0]}`, 'ok');
        go(next || '/simulator');
      } else if (mode === 'register') {
        let bad = false;
        if (!v('name').trim()) { setErr('name', 'Enter your name.'); bad = true; }
        if (!validEmail(v('email'))) { setErr('email', 'Enter a valid e-mail address.'); bad = true; }
        const issues = passwordIssues(v('password'));
        if (issues.length) { setErr('password', `Needs ${issues.join(', ')}.`); bad = true; }
        if (bad) return;
        busy(true);
        const { recoveryCode } = await register({ name: v('name'), email: v('email'), password: v('password'), org: v('org'), role: v('role') });
        showCode(recoveryCode, 'Account created', () => go('/welcome'));
      } else {
        let bad = false;
        if (!validEmail(v('email'))) { setErr('email', 'Enter a valid e-mail address.'); bad = true; }
        if (v('code').replace(/[^A-Za-z0-9]/g, '').length !== 12) { setErr('code', 'Recovery codes look like XXXX-XXXX-XXXX.'); bad = true; }
        const issues = passwordIssues(v('password'));
        if (issues.length) { setErr('password', `Needs ${issues.join(', ')}.`); bad = true; }
        if (bad) return;
        busy(true);
        const { recoveryCode } = await resetWithCode({ email: v('email'), code: v('code'), password: v('password') });
        showCode(recoveryCode, 'Password reset', () => go('/login'), 'Your old recovery code no longer works. Keep this new one.');
      }
    } catch (err) {
      busy(false);
      if (err.field) setErr(err.field, err.message); else formErr(err.message);
    }
  });

  function showCode(code, title, done, extra = '') {
    $('[data-card]').innerHTML = `
      <div class="code-card">
        <span class="ok-ic">${icon('checkCircle')}</span>
        <h1>${title}</h1>
        <p class="muted">Save this one-time recovery code somewhere safe. It is the only way to reset your password in demo mode, and it will not be shown again. ${extra}</p>
        <div class="code mono" data-code>${code}</div>
        <div class="row gap8"><button class="btn" data-copy>${icon('report')}Copy code</button><button class="btn primary grow" data-continue>Continue${icon('arrowRight')}</button></div>
      </div>`;
    $('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); toast('Recovery code copied', 'ok'); } catch { toast('Copy failed — select the code and copy it manually', 'warn'); }
    });
    $('[data-continue]').addEventListener('click', done);
  }

  return () => { unsubHud(); iso.destroy(); driver.stop(); stopVis(); };
}
