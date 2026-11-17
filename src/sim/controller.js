// Shared simulation controller — the single source of truth for every view.
// The 2D plan, the 3D model, the charts and the metrics panels all read the
// same Simulation instance owned here, so they always show the same grid,
// agent positions, exit status and simulation time.
import { createHall406, cloneLayout, compile, T, serializeLayout, deserializeLayout } from './layout.js';
import { Simulation, MODEL } from './engine.js';
import { SCENARIOS, scenarioById } from './scenarios.js';
import { analyzeRisk } from './risk.js';

const stripVenueParams = (p) => { const { profiles, spawn, speedFactor, reactionAdd, unfamiliarPenalty, ...rest } = p; void profiles; void spawn; void speedFactor; void reactionAdd; void unfamiliarPenalty; return { slowFraction: 0.05, wheelchairs: 0, ...rest }; };

class Controller {
  constructor() {
    this.original = createHall406();
    this.scenarioId = 'normal';
    const sc = scenarioById(this.scenarioId);
    this.layout = cloneLayout(this.original);
    this.layout.blocked = [...sc.blocked];
    this.params = { ...sc.params, seed: 406, maxTime: 600 };
    this.speed = 2;
    this.running = false;
    this.listeners = new Set();
    this.acc = 0;
    this.alpha = 1;
    this.result = null;
    this.previous = null; // last completed run (for curve overlay)
    this.recs = null;
    this.compare = null;
    this.layoutVersion = 0;
    this.buildSim();
    this._tick = this._tick.bind(this);
    this._raf = 0;
    this._last = 0;
  }

  // ---------------------------------------------------------------- events
  subscribe(fn) {
    this.listeners.add(fn);
    this._ensureLoop();
    return () => { this.listeners.delete(fn); };
  }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  _ensureLoop() {
    if (this._raf) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }
  _tick(now) {
    this._raf = 0;
    if (!this.listeners.size) return; // nobody is watching: suspend (state is kept)
    const real = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    if (this.running && !this.sim.done) {
      this.acc += real * this.speed;
      let steps = 0;
      while (this.acc >= this.sim.dt && steps < 60) {
        this.sim.step();
        this.acc -= this.sim.dt;
        steps++;
        if (this.sim.done) break;
      }
      if (steps === 60) this.acc = 0;
      this.alpha = Math.min(1, this.acc / this.sim.dt);
      if (this.sim.done) this._finish();
    } else {
      this.alpha = 1;
    }
    this.emit('frame', { alpha: this.alpha });
    this._raf = requestAnimationFrame(this._tick);
  }

  _finish() {
    this.running = false;
    this.alpha = 1;
    this.result = this.sim.summary();
    this.result.layout = serializeLayout(this.layout);
    this.result.scenarioId = this.scenarioId;
    this.result.finishedAt = Date.now();
    try { this.result.risk = analyzeRisk(this.layout, this.result); } catch (e) { console.error(e); this.result.risk = []; }
    this.emit('done', this.result);
    this.emit('state');
  }

  // ---------------------------------------------------------------- sim lifecycle
  buildSim() {
    if (this.result) this.previous = this.result;
    this.result = null;
    this.sim = new Simulation(this.layout, this.params);
    this.compiled = this.sim.c;
    this.acc = 0;
    this.alpha = 1;
  }

  get phase() {
    const s = this.sim;
    if (s.done) return this.result?.complete === false ? 'Stopped' : 'Complete';
    if (s.t === 0) return 'Ready';
    let moving = 0, waiting = 0;
    for (let i = 0; i < s.N; i++) { if (s.state[i] === 1) moving++; else if (s.state[i] === 0) waiting++; }
    if (s.t < 3) return 'Alarm';
    if (waiting > 0 && moving < waiting) return 'Pre-movement';
    return 'Evacuating';
  }

  play() {
    if (this.sim.done) this.reset();
    this.running = true;
    this._last = performance.now();
    this.emit('state');
    this._ensureLoop();
  }
  pause() { this.running = false; this.emit('state'); }
  toggle() { this.running ? this.pause() : this.play(); }
  stepOnce() {
    this.running = false;
    if (this.sim.done) return;
    for (let i = 0; i < 10; i++) this.sim.step(); // 1 s of simulated time
    this.alpha = 1;
    if (this.sim.done) this._finish();
    this.emit('state');
    this.emit('frame', { alpha: 1 });
  }
  reset() {
    this.running = false;
    this.buildSim();
    this.emit('reset');
    this.emit('state');
    this.emit('frame', { alpha: 1 });
  }
  setSpeed(v) { this.speed = v; this.emit('state'); }

  setScenario(id) {
    const sc = scenarioById(id);
    // the built-in scenarios belong to Hall 406: leave a loaded custom venue first
    if (this.venue || this.params.profiles) { this.venue = null; this.layout = cloneLayout(this.original); this.params = stripVenueParams(this.params); }
    this.scenarioId = id;
    this.params = { ...this.params, ...sc.params };
    this.layout.blocked = [...sc.blocked];
    this.recs = null;
    this.compare = null;
    this.layoutChanged();
  }

  setParams(patch) {
    this.params = { ...this.params, ...patch };
    this.recs = null;
    this.running = false;
    this.buildSim();
    this.emit('params');
    this.emit('reset');
    this.emit('state');
    this.emit('frame', { alpha: 1 });
  }

  layoutChanged() {
    this.layoutVersion++;
    this.running = false;
    this.buildSim();
    this.emit('layout');
    this.emit('reset');
    this.emit('state');
    this.emit('frame', { alpha: 1 });
  }

  toggleBlocked(name) {
    const b = new Set(this.layout.blocked);
    b.has(name) ? b.delete(name) : b.add(name);
    this.layout.blocked = [...b];
    this.recs = null;
    this.layoutChanged();
  }

  setLayout(layout) {
    this.layout = cloneLayout(layout);
    this.recs = null;
    this.layoutChanged();
  }

  resetLayout() {
    const blocked = this.layout.blocked.filter((n) => ['Door A', 'Door B', 'Door C', 'West stair', 'North fire stair', 'Lobby exit'].includes(n));
    this.venue = null;
    this.params = stripVenueParams(this.params);
    this.layout = cloneLayout(this.original);
    this.layout.blocked = blocked;
    this.recs = null;
    this.compare = null;
    this.layoutChanged();
  }

  /** Paint cells in the layout editor. Openings must sit in a wall line. */
  paint(cells, type) {
    const L = this.layout;
    let changed = false;
    for (const c of cells) {
      if (c < 0 || c >= L.cells.length) continue;
      const x = c % L.w, y = (c / L.w) | 0;
      if (x === 0 || y === 0 || x === L.w - 1 || y === L.h - 1) continue; // keep a void border
      if (L.cells[c] === type) continue;
      L.cells[c] = type;
      if (type !== T.DOOR && type !== T.EXIT) delete L.labels[c];
      changed = true;
    }
    if (changed) {
      if (!L.modifications.includes('Edited in layout editor')) L.modifications.push('Edited in layout editor');
      this.recs = null;
      this.layoutChanged();
    }
    return changed;
  }

  // ---------------------------------------------------------------- recommendations
  async recommend(onProgress) {
    const { runRecommendations } = await import('./recommend.js');
    this.recs = { status: 'running', done: 0, total: 0 };
    this.emit('recs');
    try {
      const r = await runRecommendations(this.layout, { ...this.params }, (d, t, label) => {
        this.recs = { status: 'running', done: d, total: t, label };
        onProgress?.(d, t, label);
        this.emit('recs');
      });
      this.recs = { status: 'done', ...r, scenarioId: this.scenarioId, layoutVersion: this.layoutVersion };
    } catch (e) {
      console.error(e);
      this.recs = { status: 'error', message: String(e?.message || e) };
    }
    this.emit('recs');
    return this.recs;
  }

  /** Apply a tested change: keep before/after results (same seed) and rebuild the live sim. */
  applyRecommendation(item) {
    if (!this.recs || this.recs.status !== 'done') return;
    this.compare = {
      title: item.title,
      scenarioId: this.scenarioId,
      before: { result: this.recs.baseline.result, layout: serializeLayout(this.layout), meanRset: this.recs.baseline.meanRset },
      after: { result: item.result, layout: item.layout, meanRset: item.meanRset },
      saved: item.saved, savedMin: item.savedMin, savedMax: item.savedMax,
    };
    this.layout = deserializeLayout(item.layout);
    this.recs = null;
    this.layoutChanged();
    this.emit('compare');
  }

  /** Load a Venue Studio venue (rasterised layout + configured parameters). */
  loadVenue(layout, params, venueInfo) {
    this.layout = cloneLayout(layout);
    this.params = { ...params };
    this.venue = venueInfo || null;
    this.scenarioId = 'custom';
    this.recs = null;
    this.compare = null;
    this.previous = null;
    this.layoutChanged();
    this.emit('params');
  }

  /** Back to the built-in Hall 406 model. */
  unloadVenue() {
    this.venue = null;
    this.layout = cloneLayout(this.original);
    this.scenarioId = 'normal';
    this.params = { ...scenarioById('normal').params, seed: 406, maxTime: 600 };
    this.recs = null;
    this.compare = null;
    this.layoutChanged();
    this.emit('params');
  }

  /** Visual highlight of a location (metres) shown by the 2D and 3D views. */
  highlight(h) { this.hl = h ? { ...h, at: performance.now() } : null; this.emit('highlight', this.hl); this.emit('frame', { alpha: this.alpha }); }

  get scenarios() { return SCENARIOS; }
  get model() { return MODEL; }
}

export const controller = new Controller();
// development hook for automated UI checks (stripped from production builds)
if (import.meta.env?.DEV) globalThis.__epController = controller;
export { compile };
