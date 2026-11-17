// Run a batch of headless simulations in Web Workers (used by the overview
// benchmark, the before/after showcase and the sample-report generator).
import { serializeLayout } from './layout.js';

export function runBatch(items, onProgress) {
  // items: [{ layout, params, full }]
  const results = new Array(items.length);
  const pool = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1, items.length));
  let next = 0, done = 0;
  return new Promise((resolve, reject) => {
    const workers = [];
    const finish = () => { workers.forEach((x) => x.terminate()); resolve(results); };
    const pump = (w) => {
      if (next >= items.length) return;
      const k = next++;
      w.onmessage = (e) => {
        results[k] = e.data;
        done++;
        onProgress?.(done, items.length);
        if (done === items.length) finish(); else pump(w);
      };
      w.onerror = (e) => { workers.forEach((x) => x.terminate()); reject(e); };
      w.postMessage({ layout: serializeLayout(items[k].layout), params: items[k].params, full: items[k].full !== false });
    };
    for (let i = 0; i < pool; i++) { const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); workers.push(w); pump(w); }
  });
}
