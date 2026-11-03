// Registre canadien (Transport Canada) : immatriculation C-XXXX → constructeur, modèle, type SkyHunt.
// Le fichier data/registre-ca.json est régénéré chaque semaine par GitHub Actions
// (tools/build_registre.py). Il ne contient aucune donnée sur les propriétaires.

let cache = null;

export function loadRegistry() {
  if (!cache) {
    cache = fetch('data/registre-ca.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return cache;
}

/** Normalise une immatriculation : « c gxyz », « CGXYZ » → « C-GXYZ ». */
export function normalizeRegistration(raw) {
  const s = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  if (/^C[FGI][A-Z]{3}$/.test(s)) return `C-${s.slice(1)}`;
  if (/^N[0-9][0-9A-Z]{0,4}$/.test(s)) return s;
  const dash = (raw || '').toUpperCase().match(/^([A-Z0-9]{1,2})-([A-Z0-9]{2,5})$/);
  return dash ? `${dash[1]}-${dash[2]}` : (raw || '').toUpperCase().trim();
}

/** Cherche une immatriculation canadienne. Renvoie { make, model, typeId, date } ou null. */
export async function lookupRegistration(reg) {
  const norm = normalizeRegistration(reg);
  const m = norm.match(/^C-([FGI][A-Z]{3})$/);
  if (!m) return null;
  const db = await loadRegistry();
  if (!db) return null;
  const idx = db.marks[m[1]];
  if (idx == null) return null;
  const [make, model, typeId] = db.models[idx];
  // « Saab » + « SAAB 340B » → « Saab 340B »
  const label = model.toUpperCase().startsWith(make.toUpperCase().split(' ')[0])
    ? `${make.split(' ')[0]}${model.slice(make.split(' ')[0].length)}`
    : `${make} ${model}`;
  return { registration: norm, make, model, label, typeId: typeId || null, date: db.date };
}

export async function registryHas(mark4) {
  const db = await loadRegistry();
  return !!(db && db.marks[mark4] != null);
}
