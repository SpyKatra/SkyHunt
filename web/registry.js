// Registre canadien (Transport Canada) : immatriculation C-XXXX → constructeur, modèle, type SkyHunt.
// Le fichier data/registre-ca.json est régénéré chaque semaine par GitHub Actions
// (tools/build_registre.py). Il ne contient aucune donnée sur les propriétaires.
// Module partagé avec l'app native (native/metro.config.js) : pas de DOM ici.

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
  // États-Unis : N + 1 à 5 caractères.
  for (const m of joined.matchAll(/\bN([1-9][0-9]{0,4}[A-Z]{0,2})\b/g)) {
    if (m[0].length >= 3) add(m[0], 30);
  }
  // Autres pays : préfixe-suffixe (F-GKXA, D-AIXX, G-EUUA, EI-FXA, 9H-…).
  for (const m of joined.matchAll(/\b([A-Z]{1,2}|[0-9][A-Z])-([A-Z]{3,4}|[A-Z0-9]{3,5})\b/g)) {
    if (m[1] === 'C') continue;
    add(`${m[1]}-${m[2]}`, 20);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([reg, score]) => ({ reg, score }));
}
