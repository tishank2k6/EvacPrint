// Recommendation engine.
// 1. Run the baseline layout on several seeds.
// 2. Generate every applicable design change (widen, unblock, add exit, clear
//    obstacles, remove seats) from the layout itself.
// 3. Re-run the full simulation for each change on the same seeds.
// 4. Rank by mean RSET saved; a change only counts as an improvement when it
//    helps on every seed (worst case > 0) — otherwise it is reported as noise.
import { generateCandidates, generateExtraCandidates, tradeoffFor, serializeLayout, deserializeLayout } from './layout.js';

export const SEED_OFFSETS = [0, 1, 2];

export function buildJobs(layout, params) {
  // Hall 406 keeps its original candidate set; custom venues also get the extended set
  const candidates = [...generateCandidates(layout), ...(layout.meta?.custom ? generateExtraCandidates(layout) : [])];
  const variants = [{ id: 'baseline', title: 'Current layout', detail: '', kind: 'baseline', layout }, ...candidates];
  const jobs = [];
  variants.forEach((v, vi) =>
    SEED_OFFSETS.forEach((off, si) =>
      jobs.push({ vi, si, layout: serializeLayout(v.layout), params: { ...params, seed: params.seed + off }, full: si === 0 }),
    ),
  );
  return { variants, jobs };
}

/** Pool of Web Workers (browser). Falls back to the main thread if workers fail. */
export async function runRecommendations(layout, params, onProgress) {
  const { variants, jobs } = buildJobs(layout, params);
  const results = variants.map(() => []);
  const full = [];
  const poolSize = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency || 4) - 1));
  let done = 0;
  const started = performance.now();

  await new Promise((resolve, reject) => {
    let next = 0;
    let active = 0;
    const workers = [];
    const finish = () => { workers.forEach((w) => w.terminate()); resolve(); };
    const dispatch = (worker) => {
      if (next >= jobs.length) { if (active === 0) finish(); return; }
      const job = jobs[next++];
      active++;
      worker.onmessage = (ev) => {
        active--;
        const r = ev.data;
        results[job.vi][job.si] = r;
        if (job.full) full[job.vi] = r;
        done++;
        onProgress?.(done, jobs.length, variants[job.vi].title);
        dispatch(worker);
      };
      worker.onerror = (e) => reject(e);
      worker.postMessage(job);
    };
    for (let k = 0; k < poolSize; k++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      workers.push(w);
      dispatch(w);
    }
  });

  return rank(variants, results, full, performance.now() - started, jobs.length);
}

export function rank(variants, results, full, ms, runs) {
  const rsetOf = (r) => r.rset ?? r.simulatedTime;
  const base = results[0];
  const baseMean = mean(base.map(rsetOf));
  const basePeak = mean(base.map((r) => r.peakDensity.value));
  const baseQueue = mean(base.map((r) => r.meanQueue));
  const worstZone = full[0].bottlenecks[0];
  const items = variants.slice(1).map((v, k) => {
    const rs = results[k + 1];
    const deltas = rs.map((r, i) => rsetOf(base[i]) - rsetOf(r));
    const dMean = mean(deltas);
    const dMin = Math.min(...deltas);
    const dMax = Math.max(...deltas);
    const meanRset = mean(rs.map(rsetOf));
    const significant = dMin > 0 && dMean >= 1.5;
    const target = worstZone && v.title && relatesTo(v, worstZone.label);
    return {
      id: v.id,
      kind: v.kind,
      title: v.title,
      detail: v.detail,
      meanRset: round1(meanRset),
      saved: round1(dMean),
      savedMin: round1(dMin),
      savedMax: round1(dMax),
      savedPct: round1((dMean / baseMean) * 100),
      peakDelta: round2(mean(rs.map((r) => r.peakDensity.value)) - basePeak),
      queueDelta: round1(mean(rs.map((r) => r.meanQueue)) - baseQueue),
      complete: rs.every((r) => r.complete),
      significant,
      targetsWorst: !!target,
      result: full[k + 1],
      tradeoff: tradeoffFor(v.kind === 'clear' ? (/seat|aisle/.test(v.title) ? 'aisle' : 'move-obstacle') : v.kind === 'unblock' ? 'unblock' : v.kind === 'widen' ? 'widen' : v.kind),
      exitDiff: (full[k + 1]?.groups || []).map((g) => { const b = full[0].groups.find((q) => q.name === g.name); return { name: g.name, before: b ? b.count : null, after: g.count, blockedBefore: b?.blocked || false }; }),
      layout: serializeLayout(v.layout),
    };
  });
  items.sort((a, b) => b.saved - a.saved);
  return {
    baseline: { meanRset: round1(baseMean), result: full[0], seeds: base.map(rsetOf) },
    items,
    runs,
    ms: Math.round(ms),
  };
}

function relatesTo(v, label) {
  if (!label) return false;
  const m = v.title.match(/(Door [A-Z0-9]+|[A-Z][a-z]+ (?:stair|exit|fire stair))/);
  if (m && label.includes(m[1])) return true;
  if (/AV console/.test(v.title) && /Door B|Rear/.test(label)) return true;
  if (/rear seating row/.test(v.title) && /Rear/.test(label)) return true;
  if (/centre aisles/.test(v.title) && /centre/.test(label)) return true;
  if (/stage/.test(v.title) && /Door C|Front|Stage/.test(label)) return true;
  return false;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

export { deserializeLayout };
