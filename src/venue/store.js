// Venue persistence (IndexedDB — photos and plans are too large for localStorage).
// Records are scoped to the signed-in user of the existing auth system.
import { currentUser } from '../auth/auth.js';

const DB = 'evacprint';
const VER = 1;
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('venues')) d.createObjectStore('venues', { keyPath: 'id' }).createIndex('owner', 'owner');
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' }).createIndex('venueId', 'venueId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((r) => (out = r));
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
};
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const owner = () => currentUser()?.email || 'anon';

export async function listVenues() {
  const all = await tx('venues', 'readonly', (s) => req(s.index('owner').getAll(owner())));
  return (all || []).sort((a, b) => b.updatedAt - a.updatedAt);
}
export const getVenue = (id) => tx('venues', 'readonly', (s) => req(s.get(id))).then((v) => (v && v.owner === owner() ? v : null));
export async function saveVenue(v) {
  v.owner = owner();
  v.updatedAt = Date.now();
  // keep only the 12 most recent full runs to bound storage
  if (v.runs?.length > 12) v.runs = v.runs.slice(-12);
  await tx('venues', 'readwrite', (s) => req(s.put(JSON.parse(JSON.stringify(v)))));
  return v;
}
export async function deleteVenue(id) {
  const media = await listMedia(id);
  await tx('media', 'readwrite', (s) => Promise.all(media.map((m) => req(s.delete(m.id)))));
  await tx('venues', 'readwrite', (s) => req(s.delete(id)));
}

export const putMedia = (m) => tx('media', 'readwrite', (s) => req(s.put({ ...m, owner: owner() })));
export const getMedia = (id) => tx('media', 'readonly', (s) => req(s.get(id)));
export const listMedia = (venueId) => tx('media', 'readonly', (s) => req(s.index('venueId').getAll(venueId))).then((a) => (a || []).sort((x, y) => x.createdAt - y.createdAt));
export const deleteMedia = (id) => tx('media', 'readwrite', (s) => req(s.delete(id)));

export async function duplicateVenue(v) {
  const { uid } = await import('./model.js');
  const copy = JSON.parse(JSON.stringify(v));
  copy.id = uid('v');
  copy.name = `${v.name} (copy)`;
  copy.createdAt = Date.now();
  copy.runs = [];
  const media = await listMedia(v.id);
  const map = {};
  for (const m of media) { map[m.id] = uid('m'); await putMedia({ ...m, id: map[m.id], venueId: copy.id }); }
  if (copy.plan.background?.mediaId) copy.plan.background.mediaId = map[copy.plan.background.mediaId] || null;
  return saveVenue(copy);
}
