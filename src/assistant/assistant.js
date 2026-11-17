// EvacPrint AI — floating assistant available on every page.
// Text chat streams from Claude through the EvacPrint server; when no model is
// configured, a clearly labelled offline guide answers from live data instead.
// Voice uses the browser's own speech recognition and synthesis (record, then
// respond) — it is not a real-time audio stream.
import { icon } from '../ui/icons.js';
import { esc, toast } from '../ui/dom.js';
import { aiStatus, chatTurn } from './api.js';
import { contextBlock } from './context.js';
import { CONFIRM, validateInput, describe, execute } from './tools.js';
import { offlineReply } from './offline.js';
import { currentUser } from '../auth/auth.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = 'speechSynthesis' in window;

const state = {
  open: false,
  full: false,
  level: 'intermediate',
  mode: 'assist',
  muted: false,
  messages: [], // Claude API message params (kept append-only)
  status: null,
  busy: false,
  abort: null,
};

const PAGE_FOR = { overview: '/', simulator: '/simulator', '3d': '/3d', venues: '/venues', 'how-it-works': '/how-it-works', technology: '/technology', learn: '/learn', reports: '/reports' };
const navigate = (page) => { const to = PAGE_FOR[page] || '/'; if (location.hash !== `#${to}`) location.hash = to; };
const openLearning = (topic) => { location.hash = topic.startsWith('lab-') ? `/learn?lab=${topic.slice(4)}` : `/learn?ex=${topic}`; };

let root, log, input, liveEl, waveEl, fab;

export function mountAssistant() {
  fab = document.createElement('button');
  fab.className = 'ai-fab';
  fab.setAttribute('aria-label', 'Open EvacPrint AI assistant');
  fab.innerHTML = `<span class="ai-orb">${icon('sparkle')}</span><span class="lbl">Ask EvacPrint AI</span>`;
  document.body.appendChild(fab);
  root = document.createElement('section');
  root.className = 'ai-panel';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'EvacPrint AI assistant');
  root.innerHTML = `
    <header class="ai-head">
      <span class="ai-orb">${icon('sparkle')}</span>
      <div class="grow"><h2>EvacPrint AI</h2><div class="ai-status" data-status><i></i><span>checking…</span></div></div>
      <button class="btn ghost sm icon" data-full title="Full screen" aria-label="Toggle full screen">${icon('split')}</button>
      <button class="btn ghost sm icon" data-clear title="Clear conversation" aria-label="Clear conversation">${icon('trash')}</button>
      <button class="btn ghost sm icon" data-close title="Close" aria-label="Close assistant">${icon('x')}</button>
    </header>
    <div class="ai-opts">
      <div class="seg" role="group" aria-label="Mode"><button data-mode="assist" aria-pressed="true">Assistant</button><button data-mode="learn" aria-pressed="false">Learn</button></div>
      <div class="seg" role="group" aria-label="Explanation level"><button data-level="beginner" aria-pressed="false">Beginner</button><button data-level="intermediate" aria-pressed="true">Intermediate</button><button data-level="advanced" aria-pressed="false">Advanced</button></div>
      <button class="btn ghost sm icon" data-mute title="Mute spoken replies" aria-pressed="false" aria-label="Mute spoken replies" ${TTS ? '' : 'disabled'}>${icon('alarm')}</button>
    </div>
    <div class="ai-log" data-log aria-live="polite"></div>
    <footer class="ai-foot">
      <div class="ai-sugg" data-sugg></div>
      <div class="ai-live" data-live hidden><div class="wave" data-wave>${'<i></i>'.repeat(18)}</div><span data-livetext></span><button class="btn sm" data-stop>${icon('pause')}Stop</button></div>
      <form class="ai-form" data-form>
        <textarea class="input" rows="1" placeholder="Ask about your simulation, or how EvacPrint works…" aria-label="Message"></textarea>
        <button type="button" class="btn icon mic" data-mic aria-label="${SR ? 'Speak' : 'Voice input not supported in this browser'}" title="${SR ? 'Speak (uses the browser’s speech recognition)' : 'Voice input is not supported in this browser — type instead'}" ${SR ? '' : 'disabled'}>${micIcon()}</button>
        <button type="submit" class="btn primary icon" aria-label="Send">${icon('arrowRight')}</button>
      </form>
      <p class="ai-note">Simulation support only — not live emergency guidance. In a real emergency call 112.</p>
    </footer>`;
  document.body.appendChild(root);
  log = root.querySelector('[data-log]');
  input = root.querySelector('textarea');
  liveEl = root.querySelector('[data-live]');
  waveEl = root.querySelector('[data-wave]');

  fab.addEventListener('click', () => toggle(true));
  root.querySelector('[data-close]').addEventListener('click', () => toggle(false));
  root.querySelector('[data-full]').addEventListener('click', () => { state.full = !state.full; root.classList.toggle('full', state.full); });
  root.querySelector('[data-clear]').addEventListener('click', () => { stopAll(); state.messages = []; log.innerHTML = ''; greet(); });
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); suggestions(); }));
  root.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => { state.level = b.dataset.level; root.querySelectorAll('[data-level]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  root.querySelector('[data-mute]').addEventListener('click', (e) => { state.muted = !state.muted; e.currentTarget.setAttribute('aria-pressed', String(state.muted)); e.currentTarget.style.opacity = state.muted ? 0.45 : 1; if (state.muted) speechSynthesis.cancel(); toast(state.muted ? 'Spoken replies muted' : 'Spoken replies on', 'info', 1200); });
  root.querySelector('[data-stop]').addEventListener('click', stopAll);
  root.querySelector('[data-mic]').addEventListener('click', () => (listening ? stopListening() : startListening()));
  root.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ''; send(t); } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); root.querySelector('[data-form]').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open && !document.querySelector('.modal-backdrop')) toggle(false); });
}

function micIcon() { return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg>'; }

async function toggle(open) {
  if (!currentUser() && open) { toast('Sign in (or enter the demo) to use EvacPrint AI', 'info'); location.hash = '/login'; return; }
  state.open = open;
  root.hidden = !open;
  fab.hidden = open;
  if (open) {
    if (!state.status) { state.status = await aiStatus(); renderStatus(); greet(); }
    suggestions();
    input.focus();
  } else stopAll();
}

function renderStatus() {
  const s = state.status;
  const el = root.querySelector('[data-status]');
  el.className = `ai-status ${s.configured ? 'on' : 'off'}`;
  el.querySelector('span').textContent = s.configured ? `Connected · ${s.provider === 'gemini' ? 'Gemini' : 'Claude'} (${s.model}) · streaming text, browser voice` : 'Offline guide — no AI model connected';
}

function greet() {
  const s = state.status;
  if (s.configured) {
    bubble('ai', `Hi${currentUser() ? `, ${currentUser().name.split(' ')[0]}` : ''}. I can see your current venue, simulation state and results. Ask me why a door is congested, what a chart means, or to test a change — I’ll ask before changing anything.`);
  } else {
    const setup = document.createElement('div');
    setup.className = 'msg sys';
    setup.innerHTML = `<div class="who">Setup</div><div class="bub ai-setup">
      <p><b>EvacPrint AI is not connected.</b> ${esc(s.reason || '')}</p>
      <p><b>Free option:</b> create a Gemini API key at <code>aistudio.google.com/apikey</code> (no card needed), put it in a file called <code>.env.local</code> in the EvacPrint folder, then restart the server:</p>
      <pre>GEMINI_API_KEY=your-key-here\nnpm run dev</pre>
      <p>An Anthropic key (<code>ANTHROPIC_API_KEY=…</code>) also works and is used instead when present. Keys stay on the server and are never sent to the browser. On Gemini’s free tier, Google may use prompts to improve its products, so don’t enter confidential information.</p>
      <p>Until then, the <b>offline guide</b> below answers from your live simulation data and a fixed knowledge base, using set phrases. It is not an AI and does not understand free conversation.</p></div>`;
    log.appendChild(setup);
    bubble('ai', 'Offline guide ready. Try one of the suggestions below.');
  }
}

function suggestions() {
  const el = root.querySelector('[data-sugg]');
  const learn = state.mode === 'learn';
  const list = learn
    ? ['Teach me how evacuation simulation works', 'Explain Dijkstra with a practical example', 'Why do people slow down in dense crowds?', 'How do we calculate people per square metre?', 'What is the faster-is-slower effect?']
    : ['What is the current evacuation progress?', 'Which exit has the highest crowd density?', 'Which area is the biggest bottleneck?', 'Run a blocked-exit scenario', 'Test a wider Door A', 'Explain the heatmap'];
  el.innerHTML = list.map((t) => `<button type="button">${esc(t)}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
}

// ---------------------------------------------------------------- rendering
function md(text) {
  const blocks = esc(text).split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-•*] /.test(l))) return `<ul>${lines.map((l) => `<li>${l.replace(/^\s*[-•*] /, '')}</li>`).join('')}</ul>`;
    return `<p>${b.replace(/\n/g, '<br>')}</p>`;
  }).join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}
function bubble(who, text, extra = '') {
  const m = document.createElement('div');
  m.className = `msg ${who === 'user' ? 'user' : 'ai'}`;
  m.innerHTML = `<div class="who">${who === 'user' ? 'You' : state.status?.configured ? 'EvacPrint AI' : 'Offline guide'}</div><div class="bub">${md(text)}</div>${extra}`;
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
  return m;
}
function sysNote(text) { const m = document.createElement('div'); m.className = 'msg sys'; m.innerHTML = `<div class="bub">${esc(text)}</div>`; log.appendChild(m); log.scrollTop = log.scrollHeight; }

function confirmCard(name, inputArgs) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'msg ai';
    m.innerHTML = `<div class="act"><b>${icon('info')} Confirm action</b><span>${esc(describe(name, inputArgs))}</span><div class="row gap8"><button class="btn sm primary" data-y>${icon('check')}Confirm</button><button class="btn sm" data-n>Cancel</button></div></div>`;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    const card = m.querySelector('.act');
    m.querySelector('[data-y]').addEventListener('click', () => { card.classList.add('done'); card.querySelector('.row').innerHTML = `<span class="small">${icon('check')} Confirmed — running…</span>`; resolve({ ok: true, card }); });
    m.querySelector('[data-n]').addEventListener('click', () => { card.classList.add('denied'); card.querySelector('.row').innerHTML = '<span class="small">Cancelled</span>'; resolve({ ok: false, card }); });
  });
}

// ---------------------------------------------------------------- conversation
async function send(text) {
  if (state.busy) { toast('Wait for the current reply (or press Stop)', 'info', 1400); return; }
  stopSpeaking();
  bubble('user', text);
  state.busy = true;
  try {
    if (state.status?.configured) await aiLoop(text);
    else await offlineTurn(text);
  } finally { state.busy = false; liveIdle(); }
}

async function offlineTurn(text) {
  const r = offlineReply(text, state.level);
  const extra = r.learn ? `<div class="links"><button class="btn sm" data-learn="${r.learn}">${icon('film')}Open the explainer</button></div>` : '';
  const m = bubble('ai', r.text, extra);
  m.querySelector('[data-learn]')?.addEventListener('click', () => openLearning(r.learn));
  if (r.highlight) await execute('highlight_area', r.highlight, { navigate, openLearning });
  speak(r.text);
  for (const a of r.actions) {
    const c = await confirmCard(a.name, a.input);
    if (!c.ok) { sysNote('Nothing was changed.'); continue; }
    try {
      const res = await execute(a.name, a.input, { navigate, openLearning });
      const summary = summarize(a.name, res);
      bubble('ai', summary);
      speak(summary);
    } catch (e) { bubble('ai', `That action failed: ${e.message || e}`); }
  }
}

function summarize(name, r) {
  if (!r.ok) return r.error || 'The action did not complete.';
  const f = (v) => (v == null ? 'incomplete' : `${v.toFixed(1)} s`);
  switch (name) {
    case 'what_if': return `Tested on a copy (seed ${r.seed}): baseline ${f(r.baseline.rset_s)}, modified ${f(r.modified.rset_s)}${r.rset_change_s != null ? ` (${r.rset_change_s > 0 ? '+' : ''}${r.rset_change_s} s)` : ''}. Peak density ${r.baseline.peak_density} → ${r.modified.peak_density} p/m². ${r.notes.join(' ')} Your layout was not changed.`;
    case 'compare_scenarios': { const [a, b] = Object.keys(r).filter((k) => !['ok', 'seed', 'venue'].includes(k)); return `${a}: ${f(r[a].rset_s)}, worst at ${r[a].worst_bottleneck || '—'}. ${b}: ${f(r[b].rset_s)}, worst at ${r[b].worst_bottleneck || '—'}. Same occupants, seed ${r.seed}.`; }
    case 'run_recommendations': return `Ran ${r.runs} simulations. Baseline ${r.baseline_mean_rset_s.toFixed(1)} s. Best: ${r.ranked.slice(0, 3).map((x) => `${x.change} (${x.mean_saved_s > 0 ? '−' : '+'}${Math.abs(x.mean_saved_s).toFixed(1)} s${x.consistent ? '' : ', within noise'})`).join('; ')}.`;
    case 'set_scenario': return `Switched to the ${r.scenario} scenario with ${r.occupants} occupants. Press Run (or ask me) to start it.`;
    case 'run_simulation': return `Started with ${r.occupants} occupants. Ask me about progress at any time.`;
    case 'set_exit_blocked': return `${r.exit} is now ${r.blocked ? 'blocked' : 'open'}. Routes have been recomputed.`;
    case 'set_occupancy': return `Occupancy set to ${r.occupants}.${r.note ? ` ${r.note}` : ''}`;
    case 'generate_report': return 'Report saved and opened.';
    default: return 'Done.';
  }
}

async function aiLoop(text) {
  const start = state.messages.length; // roll back to here if the exchange fails
  state.messages.push({ role: 'user', content: [{ type: 'text', text }, { type: 'text', text: contextBlock() }] });
  for (let turn = 0; turn < 8; turn++) {
    const m = bubble('ai', '');
    const bub = m.querySelector('.bub');
    bub.innerHTML = '<span class="spinner"></span>';
    liveThinking();
    let acc = '';
    let final;
    state.abort = new AbortController();
    try {
      final = await chatTurn({ messages: state.messages, level: state.level, mode: state.mode }, { signal: state.abort.signal, onText: (t) => { acc += t; bub.innerHTML = md(acc); log.scrollTop = log.scrollHeight; } });
    } catch (e) {
      if (state.abort?.signal.aborted) { bub.innerHTML = md(acc || 'Stopped.'); state.messages.length = start; return; }
      bub.innerHTML = `<span class="error-text">${icon('warning')}${esc(e.message || String(e))}</span>`;
      state.messages.length = start; // let the user retry from a clean history
      return;
    } finally { state.abort = null; }
    state.messages.push({ role: 'assistant', content: final.content });
    const said = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!said) m.remove(); else { bub.innerHTML = md(said); speak(said); }
    if (final.stop_reason === 'refusal') { sysNote('The model declined this request.'); return; }
    const uses = final.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) return;
    if (final.stop_reason === 'max_tokens') { sysNote('The reply was cut off before the action was complete. Please ask again.'); return; }
    const results = [];
    for (const u of uses) {
      const args = typeof u.input === 'string' ? safeParse(u.input) : u.input;
      const bad = validateInput(u.name, args);
      if (bad) { results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Invalid input: ${bad}` }); continue; }
      let card = null;
      if (CONFIRM.has(u.name)) {
        const c = await confirmCard(u.name, args);
        if (!c.ok) { results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'The user cancelled this action. Nothing was changed.' }); continue; }
        card = c.card;
      }
      const mark = (ok, msg) => { if (card) card.querySelector('.row').innerHTML = `<span class="small">${icon(ok ? 'check' : 'warning')} ${esc(msg)}</span>`; };
      try {
        const out = await execute(u.name, args, { navigate, openLearning });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
        mark(out?.ok !== false, out?.ok === false ? `Could not complete: ${out.error || 'unknown error'}` : 'Done');
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Failed: ${e.message || e}` });
        mark(false, `Failed: ${e.message || e}`);
      }
    }
    state.messages.push({ role: 'user', content: [...results, { type: 'text', text: contextBlock() }] });
  }
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ---------------------------------------------------------------- voice
let rec = null, listening = false, micStream = null, audioCtx = null, raf = 0;
function bars(levels, cls) {
  waveEl.className = `wave ${cls}`;
  waveEl.querySelectorAll('i').forEach((b, i) => { b.style.height = `${4 + Math.round((levels[i] ?? 0) * 22)}px`; });
}
function liveIdle() { if (!listening && !(TTS && speechSynthesis.speaking)) liveEl.hidden = true; }
function liveThinking() { liveEl.hidden = false; root.querySelector('[data-livetext]').textContent = 'Thinking…'; bars(new Array(18).fill(0.15), ''); }

async function startListening() {
  if (!SR) return;
  stopSpeaking();
  rec = new SR();
  rec.lang = navigator.language || 'en-IN';
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; }
    input.value = (finalText + interim).trim();
    root.querySelector('[data-livetext]').textContent = input.value || 'Listening…';
  };
  rec.onerror = (e) => {
    const msg = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was denied — type your question instead.' : e.error === 'network' ? 'Speech recognition could not reach the browser’s speech service — type instead.' : e.error === 'no-speech' ? 'No speech heard.' : `Voice input error: ${e.error}`;
    toast(msg, 'warn', 3200);
  };
  rec.onend = () => { const t = input.value.trim(); stopListening(); if (t) { input.value = ''; send(t); } };
  try { rec.start(); } catch (e) { toast(`Voice input unavailable: ${e.message}`, 'warn'); return; }
  listening = true;
  fab.classList.add('live');
  root.querySelector('[data-mic]').classList.add('on');
  root.querySelector('[data-mic]').setAttribute('aria-label', 'Stop listening');
  liveEl.hidden = false;
  root.querySelector('[data-livetext]').textContent = 'Listening…';
  // level meter for the waveform (separate stream, same permission)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const an = audioCtx.createAnalyser();
    an.fftSize = 64;
    audioCtx.createMediaStreamSource(micStream).connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    const loop = () => { if (!listening) return; an.getByteFrequencyData(data); bars(Array.from({ length: 18 }, (_, i) => data[i + 1] / 255), 'listen'); raf = requestAnimationFrame(loop); };
    loop();
  } catch { bars(new Array(18).fill(0.2), 'listen'); }
}
function stopListening() {
  listening = false;
  try { rec?.stop(); } catch { /* ignore */ }
  rec = null;
  cancelAnimationFrame(raf);
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  fab?.classList.remove('live');
  root?.querySelector('[data-mic]')?.classList.remove('on');
  liveIdle();
}

let speakTimer = 0;
function speak(text) {
  if (!TTS || state.muted || !text) return;
  speechSynthesis.cancel();
  const clean = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').slice(0, 1600);
  const u = new SpeechSynthesisUtterance(clean);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => /en-IN/i.test(v.lang)) || voices.find((v) => /en-GB/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
  u.rate = 1.03;
  let energy = 0.5;
  u.onboundary = () => { energy = 1; };
  u.onstart = () => {
    liveEl.hidden = false;
    root.querySelector('[data-livetext]').textContent = 'Speaking…';
    clearInterval(speakTimer);
    speakTimer = setInterval(() => { energy = Math.max(0.25, energy * 0.8); bars(Array.from({ length: 18 }, (_, i) => energy * (0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 120 + i)))), 'speak'); }, 80);
  };
  u.onend = u.onerror = () => { clearInterval(speakTimer); liveIdle(); };
  speechSynthesis.speak(u);
}
function stopSpeaking() { if (TTS) speechSynthesis.cancel(); clearInterval(speakTimer); liveIdle(); }
function stopAll() { stopSpeaking(); if (listening) stopListening(); state.abort?.abort(); }
