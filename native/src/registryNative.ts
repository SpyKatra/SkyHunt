// Source du registre canadien pour l'app : copie embarquée (marche hors ligne), remplacée par
// la version de la semaine publiée sur GitHub Pages (régénérée chaque lundi) quand elle est plus récente.
import { File, Paths } from 'expo-file-system';
import { setRegistrySource, setUsRegistrySource, type RegistryDb, type UsRegistryDb } from './shared';

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

// Registre américain (FAA, ≈ 250 000 avions) : pas embarqué dans l'app (trop gros). Téléchargé à la première
// marque N- rencontrée, gardé sur le téléphone et rafraîchi après une semaine.
const US_URL = 'https://spykatra.github.io/SkyHunt/data/registre-us.json';
const usFile = new File(Paths.document, 'registre-us.json');
const WEEK_MS = 7 * 86400e3;

async function usSource(): Promise<UsRegistryDb | null> {
  let cached: UsRegistryDb | null = null;
  try { if (usFile.exists) cached = JSON.parse(await usFile.text()) as UsRegistryDb; } catch { cached = null; }
  if (cached && Date.now() - Date.parse(cached.date) < WEEK_MS) return cached;
  try {
    const r = await fetch(US_URL, { cache: 'no-store' });
    if (r.ok) {
      const db = (await r.json()) as UsRegistryDb;
      if (db && db.marks && db.date) {
        if (!usFile.exists) usFile.create();
        usFile.write(JSON.stringify(db));
        return db;
      }
    }
  } catch {
    // hors ligne : ancienne copie s'il y en a une
  }
  return cached;
}

export function initRegistry() {
  setRegistrySource(source);
  setUsRegistrySource(usSource);
}
