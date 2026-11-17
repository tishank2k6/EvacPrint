// Animated explainer player: a canvas "video" with a timeline, captions
// (subtitles), transcript, play/pause/seek and keyboard control. Explainers
// draw procedurally for any time t, so seeking is exact.
import { icon } from '../ui/icons.js';
import { esc, reducedMotion, syncRange } from '../ui/dom.js';

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Player {
  constructor(host, ex) {
    this.host = host;
    this.ex = ex;
    this.t = 0;
    this.playing = false;
    this.cc = true;
    host.innerHTML = `
      <div class="player">
        <div class="player-stage">
          <div class="player-canvas"><canvas></canvas><div class="player-cap" aria-live="polite"></div></div>
          <div class="player-ctrl">
            <button class="btn sm icon" data-pp aria-label="Play">${icon('play')}</button>
            <button class="btn sm icon" data-rs aria-label="Restart">${icon('reset')}</button>
            <input type="range" min="0" max="${ex.duration}" step="0.05" value="0" aria-label="Seek" data-seek>
            <span class="player-time" data-time>0:00 / ${fmt(ex.duration)}</span>
            <button class="btn sm icon" data-cc aria-label="Toggle captions" aria-pressed="true" title="Captions">${icon('cc')}</button>
          </div>
        </div>
        <aside class="player-side">
          <span class="eyebrow">${esc(ex.topic)} · animated explainer · ${fmt(ex.duration)}</span>
          <h2 style="font-size:20px">${esc(ex.title)}</h2>
          <p>${ex.explanation}</p>
          <div class="example"><b>Example.</b> ${ex.example}</div>
          ${ex.lab ? `<a class="btn sm" href="#/learn?lab=${ex.lab}" data-lab>${icon('hand')}Try the interactive demo</a>` : ''}
          <div><div class="mini-h">Transcript</div><div class="transcript">${ex.captions.map(([t, c], i) => `<button data-i="${i}"><span class="mono">${fmt(t)}</span><span>${esc(c)}</span></button>`).join('')}</div></div>
          ${ex.source ? `<p class="faint small">${ex.source}</p>` : ''}
        </aside>
      </div>`;
    this.cv = host.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.cap = host.querySelector('.player-cap');
    this.seek = host.querySelector('[data-seek]');
    host.querySelector('[data-pp]').addEventListener('click', () => this.toggle());
    host.querySelector('[data-rs]').addEventListener('click', () => { this.set(0); this.play(); });
    host.querySelector('[data-cc]').addEventListener('click', (e) => {
      this.cc = !this.cc;
      e.currentTarget.setAttribute('aria-pressed', String(this.cc));
      this.render();
    });
    this.seek.addEventListener('input', () => { this.set(+this.seek.value); });
    host.querySelectorAll('.transcript button').forEach((b) => b.addEventListener('click', () => { this.set(ex.captions[+b.dataset.i][0] + 0.01); }));
    this.onKey = (e) => {
      if (!host.isConnected) return;
      if (e.target.closest('input,textarea')) return;
      if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); this.toggle(); }
      if (e.key === 'ArrowRight') this.set(Math.min(ex.duration, this.t + 5));
      if (e.key === 'ArrowLeft') this.set(Math.max(0, this.t - 5));
    };
    document.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.cv.parentElement);
    this.tick = this.tick.bind(this);
    this.ready = Promise.resolve(ex.prepare?.()).then(() => {
      // examples that quote measured results are only known after the recording
      const exEl = host.querySelector('.example');
      if (ex.example) exEl.innerHTML = `<b>Example.</b> ${ex.example}`; else exEl.remove();
      this.resize();
      if (!reducedMotion()) this.play();
    });
  }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    if (r.width < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.render();
  }
  set(t) { this.t = Math.max(0, Math.min(this.ex.duration, t)); this.render(); }
  play() {
    if (this.t >= this.ex.duration) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    this.host.querySelector('[data-pp]').innerHTML = icon('pause');
    this.host.querySelector('[data-pp]').setAttribute('aria-label', 'Pause');
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }
  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.host.querySelector('[data-pp]').innerHTML = icon('play');
    this.host.querySelector('[data-pp]').setAttribute('aria-label', 'Play');
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  tick(now) {
    if (!this.playing) return;
    this.t += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.t >= this.ex.duration) { this.t = this.ex.duration; this.render(); this.pause(); return; }
    this.render();
    this.raf = requestAnimationFrame(this.tick);
  }
  render() {
    if (!this.W) return;
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111316';
    ctx.fillRect(0, 0, this.W, this.H);
    try { this.ex.draw(ctx, this.t, this.W, this.H); } catch (e) { console.error(e); }
    // captions
    let cur = -1;
    this.ex.captions.forEach(([t], i) => { if (this.t >= t) cur = i; });
    const txt = this.cc && cur >= 0 ? this.ex.captions[cur][1] : '';
    if (this.cap.textContent !== txt) this.cap.textContent = txt;
    this.host.querySelectorAll('.transcript button').forEach((b, i) => b.classList.toggle('on', i === cur));
    this.seek.value = this.t;
    syncRange(this.seek);
    this.host.querySelector('[data-time]').textContent = `${fmt(this.t)} / ${fmt(this.ex.duration)}`;
  }
  destroy() { this.pause(); this.ro.disconnect(); document.removeEventListener('keydown', this.onKey); }
}
