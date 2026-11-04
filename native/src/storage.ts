// Carnet local : fiches dans captures.json, photos dans le dossier captures/ de l'app.
// Équivalent natif de web/store.js (IndexedDB). Toutes les écritures passent par une file
// d'attente pour éviter que deux enregistrements simultanés s'écrasent.
import { Directory, File, Paths } from 'expo-file-system';
import type { Capture } from './types';

const capturesDir = new Directory(Paths.document, 'captures');
const indexFile = new File(Paths.document, 'captures.json');

let cache: Map<string, Capture> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function ensureDir() {
  if (!capturesDir.exists) capturesDir.create({ intermediates: true });
}

/** Complète une fiche ancienne ou incomplète (prototype 0.1) avec les champs attendus. */
function normalize(c: Partial<Capture> & { id: string; takenAt: string }): Capture {
  return {
    photoUri: null, width: null, height: null, latitude: null, longitude: null, accuracy: null, gpsAgeS: null,
    confidence: 0, sizeRatio: 0, sharpness: 0, brightness: 0, box: null, thresholds: null, valid: false, reasons: [],
    typeId: null, registration: null, registrationSource: null, registryModel: null, userAgent: '',
    ...c,
  };
}

async function load(): Promise<Map<string, Capture>> {
  if (cache) return cache;
  let list: Capture[] = [];
  try {
    if (indexFile.exists) {
      const raw = JSON.parse(await indexFile.text());
      if (Array.isArray(raw)) list = raw.map(normalize);
    }
  } catch {
    list = [];
  }
  cache = new Map(list.map((c) => [c.id, c]));
  return cache;
}

function persist(map: Map<string, Capture>) {
  if (!indexFile.exists) indexFile.create();
  indexFile.write(JSON.stringify([...map.values()]));
}

/** Toutes les captures, la plus récente en premier. */
export async function listCaptures(): Promise<Capture[]> {
  const map = await load();
  return [...map.values()].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export async function getCapture(id: string): Promise<Capture | undefined> {
  return (await load()).get(id);
}

export function putCapture(c: Capture): Promise<void> {
  return serial(async () => {
    const map = await load();
    map.set(c.id, c);
    persist(map);
  });
}

export function deleteCapture(id: string): Promise<void> {
  return serial(async () => {
    const map = await load();
    const c = map.get(id);
    if (c) removePhoto(c.photoUri);
    map.delete(id);
    persist(map);
  });
}

export function clearCaptures(ids?: string[]): Promise<void> {
  return serial(async () => {
    const map = await load();
    for (const c of [...map.values()]) {
      if (ids && !ids.includes(c.id)) continue;
      removePhoto(c.photoUri);
      map.delete(c.id);
    }
    persist(map);
  });
}

function removePhoto(uri: string | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // fichier déjà absent : on ignore
  }
}

/** Copie la photo prise par la caméra (fichier temporaire) dans le dossier permanent. */
export async function keepPhoto(id: string, tempPath: string): Promise<string> {
  ensureDir();
  const src = new File(tempPath.startsWith('file://') ? tempPath : `file://${tempPath}`);
  const dest = new File(capturesDir, `${id}.jpg`);
  if (dest.exists) dest.delete();
  await src.copy(dest);
  return dest.uri;
}

/** Télécharge une photo du serveur (URL signée) dans le dossier permanent. */
export async function downloadPhoto(id: string, url: string): Promise<string> {
  ensureDir();
  const dest = new File(capturesDir, `${id}.jpg`);
  if (dest.exists) dest.delete();
  const f = await File.downloadFileAsync(url, dest);
  return f.uri;
}
