// Carnet local : photos (Blob JPEG) et mesures dans IndexedDB, sur le téléphone uniquement.
const DB_NAME = 'skyhunt';
const STORE = 'captures';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export const addCapture = (c) => tx('readwrite', (s) => s.put(c));
export const deleteCapture = (id) => tx('readwrite', (s) => s.delete(id));
export const clearCaptures = () => tx('readwrite', (s) => s.clear());
export async function listCaptures() {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}
