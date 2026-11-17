// Saved reports (per user, in this browser's localStorage).
import { currentUser } from '../auth/auth.js';

const key = () => `ep.reports.${currentUser()?.email || 'anon'}`;
const read = () => { try { return JSON.parse(localStorage.getItem(key())) || []; } catch { return []; } };
const write = (v) => {
  try { localStorage.setItem(key(), JSON.stringify(v)); return true; } catch { return false; }
};

export const listReports = () => read().sort((a, b) => b.createdAt - a.createdAt);
export const getReport = (id) => read().find((r) => r.id === id) || null;

export function saveReport(rep) {
  const all = read();
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const item = { ...rep, id, createdAt: Date.now() };
  all.push(item);
  while (!write(all) && all.length > 1) all.shift(); // drop oldest if storage is full
  return item;
}

export function deleteReport(id) { write(read().filter((r) => r.id !== id)); }

/** strip heavy fields from a recommendation item for storage */
export function liteRec(it) {
  return {
    title: it.title, detail: it.detail, kind: it.kind, saved: it.saved, savedMin: it.savedMin, savedMax: it.savedMax, savedPct: it.savedPct,
    meanRset: it.meanRset, peakDelta: it.peakDelta, queueDelta: it.queueDelta, significant: it.significant, targetsWorst: it.targetsWorst, complete: it.complete,
    tradeoff: it.tradeoff || "", exitDiff: it.exitDiff || null,
  };
}
