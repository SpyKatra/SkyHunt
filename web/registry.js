// Registres d'immatriculation : immatriculation → constructeur, modèle, type SkyHunt.
//  - Canada (Transport Canada) : C-XXXX, data/registre-ca.json (tools/build_registre.py)
//  - États-Unis (FAA) : N12345, data/registre-us.json (tools/build_registre_us.py), chargé seulement au besoin
// Fichiers régénérés chaque semaine par GitHub Actions ; aucune donnée sur les propriétaires.
// Module partagé avec l'app native (native/metro.config.js) : pas de DOM ici.
import { matchSeries } from './catalog.js';

let cache = null;
let source = () => fetch('data/registre-ca.json').then((r) => (r.ok ? r.json() : null));

/** L'app native fournit sa propre source (fichier embarqué + mise à jour en ligne). */
export function setRegistrySource(fn) {
  source = fn;
  cache = null;
}

export function loadRegistry() {
  if (!cache) cache = Promise.resolve().then(source).catch(() => null);
  return cache;
}

// ---- États-Unis (FAA) : ≈ 250 000 avions, chargé à la première marque N- rencontrée.
let usCache = null;
let usSource = () => fetch('data/registre-us.json').then((r) => (r.ok ? r.json() : null));

/** L'app native fournit sa propre source (téléchargée depuis GitHub Pages, gardée sur le téléphone). */
export function setUsRegistrySource(fn) {
  usSource = fn;
  usCache = null;
}

/** { date, source, models, index: Map(marque sans le N → n° de modèle) } ou null. */
export function loadUsRegistry() {
  if (!usCache) {
    const p = Promise.resolve().then(usSource).then((db) => {
      if (!db) return null;
      const index = new Map();
      db.marks.forEach((list, i) => { for (const m of list.split(' ')) if (m) index.set(m, i); });
      return { date: db.date, source: db.source, models: db.models, index };
    }).catch(() => null);
    usCache = p;
    // Échec (hors ligne) : on réessaiera à la prochaine recherche.
    p.then((db) => { if (!db && usCache === p) usCache = null; });
  }
  return usCache;
}

function labelOf(make, model) {
  // « Saab » + « SAAB 340B » → « Saab 340B »
  const first = make.split(' ')[0];
  return model.toUpperCase().startsWith(first.toUpperCase()) ? `${first}${model.slice(first.length)}` : `${make} ${model}`.trim();
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

/** Registre qui couvre cette immatriculation : 'ca', 'us' ou null. */
export function registryOf(reg) {
  const norm = normalizeRegistration(reg);
  if (/^C-[FGI][A-Z]{3}$/.test(norm)) return 'ca';
  if (/^N[1-9][0-9A-Z]{0,4}$/.test(norm)) return 'us';
  return null;
}

export const REGISTRY_NAMES = { ca: 'registre de Transport Canada', us: 'registre américain de la FAA' };

/** Message quand l'immatriculation n'est trouvée dans aucun registre. */
export function notFoundMessage(reg) {
  const which = registryOf(reg);
  if (which === 'ca') return 'introuvable au registre canadien, vérifie les lettres.';
  if (which === 'us') return 'introuvable au registre américain (FAA), vérifie les chiffres et les lettres.';
  return 'immatriculation étrangère : seuls les registres canadien (C-) et américain (N) sont couverts pour l’instant.';
}

/**
 * Cherche une immatriculation canadienne (C-XXXX) ou américaine (N…).
 * Renvoie { registration, make, model, label, typeId, seriesId, date, registry: 'ca' | 'us' } ou null
 * (seriesId : série précise reconnue d'après le modèle exact, ex. 737-8H4 → 737-800).
 */
export async function lookupRegistration(reg) {
  const norm = normalizeRegistration(reg);
  const which = registryOf(norm);
  let db = null;
  let idx = null;
  if (which === 'ca') {
    db = await loadRegistry();
    idx = db ? db.marks[norm.slice(2)] : null;
  } else if (which === 'us') {
    db = await loadUsRegistry();
    idx = db ? db.index.get(norm.slice(1)) : null;
  }
  if (idx == null) return null;
  const [make, model, typeId] = db.models[idx];
  const seriesId = typeId ? matchSeries(typeId, model) : null;
  return { registration: norm, make, model, label: labelOf(make, model), typeId: typeId || null, seriesId, date: db.date, registry: which };
}

export async function registryHas(mark4) {
  const db = await loadRegistry();
  return !!(db && db.marks[mark4] != null);
}

// Corrections « forcées » seulement : les marques canadiennes commencent par F, G ou I et ne
// contiennent que des lettres. On ne corrige pas une lettre en une autre lettre ailleurs :
// le registre est si dense que presque toutes les combinaisons existent.
const FIRST = { E: 'F', P: 'F', '6': 'G', C: 'G', '1': 'I', L: 'I', J: 'I', T: 'I' };
const DIGIT = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B' };

function fixTail(tail) {
  let fixes = 0;
  let out = '';
  for (let i = 0; i < tail.length; i++) {
    let ch = tail[i];
    if (i === 0 && !'FGI'.includes(ch) && FIRST[ch]) { ch = FIRST[ch]; fixes++; }
    else if (DIGIT[ch]) { ch = DIGIT[ch]; fixes++; }
    out += ch;
  }
  return /^[FGI][A-Z]{3}$/.test(out) ? [out, fixes] : null;
}

/** Extrait les immatriculations candidates d'un texte OCR, la meilleure en premier. */
export async function extractCandidates(text) {
  const db = await loadRegistry();
  const found = new Map(); // reg → score
  const add = (reg, score) => found.set(reg, Math.max(found.get(reg) || 0, score));
  const lines = text.toUpperCase().split(/\n+/);
  const joined = lines.join(' ');
  const compact = joined.replace(/\s+/g, '');

  // Canada : C-FXXX / C-GXXX / C-IXXX. Le tiret est souvent mal lu ou absent, et certaines
  // lettres sont confondues (F/E, J/I…) : on garde les variantes qui existent au registre.
  const re = /C[-–_.]?([A-Z0-9]{4})/g;
  for (const src of [joined.replace(/\s+-\s+|\s-|-\s/g, '-'), compact]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const dash = m[0].length === 6 ? 5 : 0;
      const fixed = fixTail(m[1]);
      if (fixed) {
        const [tail, fixes] = fixed;
        const inReg = db && db.marks[tail] != null;
        add(`C-${tail}`, (inReg ? 90 : 40) - fixes * 10 + dash);
      }
      re.lastIndex = m.index + 1; // chevauchements permis
    }
  }
  // États-Unis : N + 1 à 5 caractères (chiffres puis au plus 2 lettres). Bonus si la marque existe à la FAA
  // (registre chargé seulement si le texte contient une marque N candidate).
  const usMarks = [...joined.matchAll(/\bN([1-9][0-9]{0,4}[A-Z]{0,2})\b/g)].filter((m) => m[0].length >= 3 && m[0].length <= 6);
  const us = usMarks.length ? await loadUsRegistry() : null;
  for (const m of usMarks) add(m[0], us && us.index.has(m[1]) ? 85 : 30);
  // Autres pays : préfixe-suffixe (F-GKXA, D-AIXX, G-EUUA, EI-FXA, 9H-…).
  for (const m of joined.matchAll(/\b([A-Z]{1,2}|[0-9][A-Z])-([A-Z]{3,4}|[A-Z0-9]{3,5})\b/g)) {
    if (m[1] === 'C') continue;
    add(`${m[1]}-${m[2]}`, 20);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([reg, score]) => ({ reg, score }));
}
