import { icon } from '../ui/icons.js';
import { esc, openModal, onVisible } from '../ui/dom.js';
import { EXPLAINERS, TOPICS } from '../learn/explainers.js';
import { LABS } from '../learn/labs.js';
import { CONCEPTS, normalVsBlocked, dijkstra, abm, congestion, speedDensity, bottleneckId, doorWidth, digitize } from '../ui/illustrations.js';

const THUMB = { 'evac-sim': normalVsBlocked, dijkstra, abm, bottleneck: congestion, density: () => speedDensity({ marker: 2.15 }), fis: bottleneckId, width: doorWidth, twin: digitize };

export function mount(root, { query }) {
  root.innerHTML = `
  <div class="wrap">
    <header class="page-head">
      <span class="eyebrow">Learn</span>
      <h1>Understand the Science Behind EvacPrint</h1>
      <p>Eight short animated explainers, four hands-on labs and ten concept diagrams. The simulations inside them are real engine runs, recorded when you open them — not stock footage.</p>
    </header>
    <section>
      <div class="learn-filters" role="group" aria-label="Filter by topic">${TOPICS.map((t, i) => `<button data-topic="${t}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
      <div class="ex-grid">
        ${EXPLAINERS.map((e, i) => `<button class="ex-card card" data-ex="${i}" data-t="${e.topic}">
          <div class="ex-thumb">${THUMB[e.id]?.() || ''}<div class="ex-play"><span>${icon('play')}</span><span class="ex-dur">${Math.floor(e.duration / 60)}:${String(e.duration % 60).padStart(2, '0')} · captions</span></div></div>
          <div class="ex-body"><span class="mono">${esc(e.topic)}</span><h3>${esc(e.title)}</h3><p>${esc(e.summary)}</p></div>
        </button>`).join('')}
      </div>
    </section>
    <section class="section" id="labs">
      <div class="section-head"><span class="eyebrow">Interactive lab</span><h2>Try it yourself</h2><p>Small, independent demonstrations of the ideas the simulator is built on.</p></div>
      <div class="labs">${LABS.map((l) => `<div class="lab card" id="lab-${l.id}" data-lab="${l.id}"><div class="lab-head"><h3><span class="spinner"></span>Loading…</h3></div></div>`).join('')}</div>
    </section>
    <section class="section">
      <div class="section-head"><span class="eyebrow">Concept diagrams</span><h2>Ten ideas, one diagram each</h2></div>
      <div class="concepts">${CONCEPTS.map((c, i) => `<figure class="concept card"><div class="ill-host">${c.art()}</div><figcaption><h3><span class="mono">${String(i + 1).padStart(2, '0')}</span>${esc(c.title)}</h3><p>${esc(c.caption)}</p></figcaption></figure>`).join('')}</div>
    </section>
  </div>`;
  const cleanups = [];

  root.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-topic]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const t = b.dataset.topic;
    root.querySelectorAll('.ex-card').forEach((c) => (c.hidden = t !== 'All' && c.dataset.t !== t));
  }));

  root.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', async () => {
    const ex = EXPLAINERS[+b.dataset.ex];
    const { Player } = await import('../learn/player.js');
    let player;
    const m = openModal({ title: ex.title, wide: true, body: '<div class="player-host"></div>', onClose: () => player?.destroy() });
    player = new Player(m.body.querySelector('.player-host'), ex);
    m.body.querySelector('[data-lab]')?.addEventListener('click', (e) => {
      e.preventDefault();
      m.close();
      document.getElementById(`lab-${ex.lab}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }));

  for (const l of LABS) {
    const host = root.querySelector(`[data-lab="${l.id}"]`);
    cleanups.push(onVisible(host, () => { const stop = l.mount(host); cleanups.push(stop); }, '300px'));
  }
  const exq = query?.get('ex');
  if (exq) { const k = EXPLAINERS.findIndex((e) => e.id === exq); if (k >= 0) requestAnimationFrame(() => root.querySelector(`[data-ex="${k}"]`)?.click()); }
  const lab = query?.get('lab');
  if (lab) requestAnimationFrame(() => document.getElementById(`lab-${lab}`)?.scrollIntoView({ block: 'center' }));

  return () => cleanups.forEach((f) => f?.());
}
