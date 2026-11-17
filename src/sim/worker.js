// Headless simulation worker used by the recommendation engine.
import { deserializeLayout } from './layout.js';
import { runHeadless } from './engine.js';

self.onmessage = (ev) => {
  const { layout, params, full } = ev.data;
  const r = runHeadless(deserializeLayout(layout), params);
  if (!full) {
    // keep messages small for the non-reference seeds
    delete r.exposure;
    delete r.peakMap;
    delete r.curve;
    delete r.agents;
  }
  self.postMessage(r);
};
