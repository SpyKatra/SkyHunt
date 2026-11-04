// Journal de plantage : si une erreur JavaScript ferme l'app, son message est écrit (de façon
// synchrone) dans un fichier, puis affiché au lancement suivant. Utile tant qu'on teste sans câble.
// Un plantage natif (caméra, modèle) n'est pas attrapé ici.
import { File, Paths } from 'expo-file-system';
import { Alert } from 'react-native';

const crashFile = new File(Paths.document, 'dernier-plantage.txt');

type Handler = (error: unknown, isFatal?: boolean) => void;
const EU = (globalThis as unknown as { ErrorUtils?: { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void } }).ErrorUtils;

export function installCrashLog() {
  if (EU == null) return;
  const previous = EU.getGlobalHandler();
  EU.setGlobalHandler((error, isFatal) => {
    try {
      const e = error instanceof Error ? error : new Error(String(error));
      const text = `${new Date().toISOString()} ${isFatal ? 'FATAL' : 'erreur'}\n${e.message}\n${(e.stack ?? '').split('\n').slice(0, 8).join('\n')}`;
      if (crashFile.exists) crashFile.delete();
      crashFile.create();
      crashFile.write(text);
    } catch {
      // rien : on ne doit jamais planter dans le gestionnaire de plantage
    }
    previous(error, isFatal);
  });
}

/** Au lancement : montre le dernier plantage enregistré, puis l'efface. */
export function showLastCrash() {
  try {
    if (!crashFile.exists) return;
    const text = crashFile.textSync();
    crashFile.delete();
    Alert.alert('Plantage précédent', `Fais une capture d'écran de ce message pour Claude :\n\n${text.slice(0, 900)}`);
  } catch {
    // ignore
  }
}
