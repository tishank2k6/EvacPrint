import { currentUser, updateProfile } from '../auth/auth.js';
import { icon, logoMark } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { storyArt } from '../ui/illustrations.js';

const STEPS = [
  { k: 'risk', t: 'Your venue has an evacuation risk you cannot see', d: 'Door widths, chair rows, a stored cabinet in front of an exit — layout decisions are made without ever measuring how long it takes to get everyone out.' },
  { k: 'simulate', t: 'EvacPrint turns it into a virtual hall and runs the emergency', d: 'The floor plan becomes a 0.5 m grid. Hundreds of agents react to an alarm, walk the shortest routes, slow down in crowds and queue at doors.' },
  { k: 'optimise', t: 'It finds the bottleneck and tests the fixes for you', d: 'The recommendation engine re-runs the whole evacuation for every design change it can make, and ranks them by seconds saved — then writes it up as a report.' },
];

export function mount(root) {
  const u = currentUser();
  let step = 0;
  root.innerHTML = `
  <div class="welcome grid-bg">
    <div class="welcome-card">
      <div class="row between"><span class="brand">${logoMark(26)}<span>EvacPrint</span></span><button class="btn ghost sm" data-skip>Skip intro</button></div>
      <div class="welcome-body">
        <div class="welcome-art" data-art></div>
        <div class="welcome-copy">
          <span class="eyebrow" data-eb></span>
          <h1 data-t></h1>
          <p class="muted" data-d></p>
          <div class="dots" role="tablist" aria-label="Introduction steps">${STEPS.map((_, i) => `<button role="tab" data-dot="${i}" aria-label="Step ${i + 1}"></button>`).join('')}</div>
          <div class="row gap8">
            <button class="btn ghost" data-back>${icon('arrowLeft')}Back</button>
            <button class="btn primary grow" data-next></button>
          </div>
        </div>
      </div>
      <p class="faint small center">Signed in as ${esc(u.name)}${u.demo ? ' (demo workspace)' : ''}</p>
    </div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const finish = (to = '/simulator') => { updateProfile({ onboarded: true }); location.hash = to; };
  const show = () => {
    const s = STEPS[step];
    $('[data-art]').innerHTML = storyArt(s.k);
    $('[data-eb]').textContent = `Step ${step + 1} of ${STEPS.length}`;
    $('[data-t]').textContent = s.t;
    $('[data-d]').textContent = s.d;
    root.querySelectorAll('[data-dot]').forEach((d) => d.setAttribute('aria-selected', String(+d.dataset.dot === step)));
    $('[data-back]').disabled = step === 0;
    $('[data-next]').innerHTML = step === STEPS.length - 1 ? `${icon('play')}Open the simulator` : `Next${icon('arrowRight')}`;
  };
  $('[data-next]').addEventListener('click', () => (step < STEPS.length - 1 ? (step++, show()) : finish()));
  $('[data-back]').addEventListener('click', () => { if (step > 0) { step--; show(); } });
  $('[data-skip]').addEventListener('click', () => finish());
  root.querySelectorAll('[data-dot]').forEach((d) => d.addEventListener('click', () => { step = +d.dataset.dot; show(); }));
  show();
}
