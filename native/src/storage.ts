import { Directory, File, Paths } from 'expo-file-system';
import type { Capture } from './types';

const capturesDir = new Directory(Paths.document, 'captures');
const indexFile = new File(Paths.document, 'captures.json');

function ensureDir() {
  if (!capturesDir.exists) capturesDir.create({ intermediates: true });
}

export async function loadCaptures(): Promise<Capture[]> {
  try {
    if (!indexFile.exists) return [];
    const raw = await indexFile.text();
    const list = JSON.parse(raw) as Capture[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveIndex(list: Capture[]) {
  if (!indexFile.exists) indexFile.create();
  indexFile.write(JSON.stringify(list));
}

/**
 * Copie la photo prise par la caméra dans le dossier permanent de l'app
 * et ajoute la capture en tête du carnet.
 */
export async function addCapture(tempPhotoPath: string, capture: Omit<Capture, 'photoUri'>): Promise<Capture[]> {
  ensureDir();
  const srcUri = tempPhotoPath.startsWith('file://') ? tempPhotoPath : `file://${tempPhotoPath}`;
  const src = new File(srcUri);
  const dest = new File(capturesDir, `${capture.id}.jpg`);
  await src.copy(dest);

  const list = await loadCaptures();
  const full: Capture = { ...capture, photoUri: dest.uri };
  const next = [full, ...list];
  await saveIndex(next);
  return next;
}

export async function deleteCapture(id: string): Promise<Capture[]> {
  const list = await loadCaptures();
  const target = list.find((c) => c.id === id);
  if (target) {
    try {
      const f = new File(target.photoUri);
      if (f.exists) f.delete();
    } catch {
      // fichier déjà absent : on ignore
    }
  }
  const next = list.filter((c) => c.id !== id);
  await saveIndex(next);
  return next;
}
