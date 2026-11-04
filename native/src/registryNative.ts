// Source du registre canadien pour l'app : copie embarquée (marche hors ligne), remplacée par
// la version de la semaine publiée sur GitHub Pages (régénérée chaque lundi) quand elle est plus récente.
import { File, Paths } from 'expo-file-system';
import { setRegistrySource, type RegistryDb } from './shared';

const ONLINE_URL = 'https://spykatra.github.io/SkyHunt/data/registre-ca.json';
const cacheFile = new File(Paths.document, 'registre-ca.json');

async function readCached(): Promise<RegistryDb | null> {
  try {
    return cacheFile.exists ? (JSON.parse(await cacheFile.text()) as RegistryDb) : null;
  } catch {
    return null;
  }
}

function embedded(): RegistryDb {
  // Chargé seulement au premier besoin (≈ 500 Ko).
  return require('../../web/data/registre-ca.json') as RegistryDb;
}

let current: RegistryDb | null = null;

async function source(): Promise<RegistryDb> {
  const cached = await readCached();
  const base = embedded();
  current = cached && cached.date > base.date ? cached : base;
  refresh(); // en arrière-plan
  return current;
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const r = await fetch(ONLINE_URL, { cache: 'no-store' });
    if (!r.ok) return;
    const db = (await r.json()) as RegistryDb;
    if (db && db.marks && db.date && (!current || db.date > current.date)) {
      if (!cacheFile.exists) cacheFile.create();
      cacheFile.write(JSON.stringify(db));
      current = db;
      setRegistrySource(() => db); // les prochaines recherches utilisent la nouvelle version
    }
  } catch {
    // hors ligne : on garde la version actuelle
  } finally {
    refreshing = false;
  }
}

export function initRegistry() {
  setRegistrySource(source);
}
