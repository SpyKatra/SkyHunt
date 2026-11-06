// Mode de collecte (Android, développement) : photos étiquetées « réel » ou « écran » pour entraîner plus tard
// un détecteur de photos d'écran. Rien n'est envoyé : tout reste sur le téléphone, dans le dossier externe de l'app,
// lisible par adb (l'app compilée n'est pas débogable, son dossier interne ne l'est pas).
// Pas de position GPS dans les fiches. À retirer de l'interface avant la bêta.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

export type CollectLabel = 'reel' | 'ecran';

/** Android seulement : pas d'accès adb sur iPhone. */
export const COLLECT_AVAILABLE = Platform.OS === 'android';

// Créé par Android pour l'app ; aucune permission n'est nécessaire pour y écrire.
const OUT_URI = 'file:///storage/emulated/0/Android/data/com.spykatra.skyhunt/files/';

/** Nombre de photos déjà collectées, par étiquette. */
export function countSamples(): Record<CollectLabel, number> {
  const n: Record<CollectLabel, number> = { reel: 0, ecran: 0 };
  const out = new Directory(OUT_URI);
  if (!out.exists) return n;
  for (const item of out.list()) {
    if (!item.name.endsWith('.jpg')) continue;
    if (item.name.startsWith('reel_')) n.reel++;
    else if (item.name.startsWith('ecran_')) n.ecran++;
  }
  return n;
}

/** Retire du carnet une photo qui ne devient pas une capture. */
export function dropPhoto(uri: string): void {
  new File(uri).delete();
}

/**
 * Copie la photo et ses mesures dans le dossier de collecte.
 * Écrit d'abord dans le cache, puis copie vers le dossier : expo-file-system refuse d'écrire
 * un fichier qui n'existe pas encore hors des dossiers internes, mais accepte de copier dans un dossier.
 */
export async function saveSample(label: CollectLabel, photoUri: string, meta: Record<string, unknown>): Promise<void> {
  const out = new Directory(OUT_URI);
  const name = `${label}_${Date.now()}`;
  const tmp = new Directory(Paths.cache, 'collecte');
  if (!tmp.exists) tmp.create({ intermediates: true });
  const jpg = new File(tmp, `${name}.jpg`);
  const json = new File(tmp, `${name}.json`);
  await new File(photoUri).copy(jpg);
  json.create();
  json.write(JSON.stringify({ label, ...meta }, null, 1));
  try {
    await jpg.copy(out);
    await json.copy(out);
  } finally {
    jpg.delete();
    json.delete();
  }
}
