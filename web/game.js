// Règles du jeu : calcul des points, niveaux, succès et statistiques.
// Formule du document : Score = (P_appareil + P_lieu) × Q × R + Bonus
import { AIRCRAFT, RARITIES, getType, nearestAirport } from './catalog.js';

// Points de lieu : calculés par le serveur selon la rareté du lieu (captures de tous les joueurs à moins
// de 5 km avant celle-ci : aucune → 5, 1-9 → 3, 10-49 → 2, 50+ → 1), reçus dans `placePoints`.
// Sans compte ou pas encore synchronisée : 1. Voir supabase/migrations/20261104120000_classements.sql.
const PLACE_POINTS = 1;
const REPEAT_FACTORS = [1, 0.5, 0.25, 0.1];
const NEW_TYPE_BONUS = 5;

/** Photo « excellente » : avion bien reconnu et assez grand. */
export function isExcellent(c) {
  return c.confidence >= 0.8 && c.sizeRatio >= 0.4;
}

const normReg = (r) => (r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Recalcule les points de toutes les captures, dans l'ordre chronologique.
 * Renvoie une nouvelle liste (même ordre que l'entrée) avec `points` et `breakdown`.
 */
export function recomputeAll(list) {
  // Même ordre que le serveur (heure, puis identifiant) pour que les points soient identiques.
  const chrono = [...list].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const typeCount = {};
  const regs = new Set();
  const out = new Map();

  for (const c of chrono) {
    if (!c.valid) {
      out.set(c.id, { ...c, points: 0, breakdown: null });
      continue;
    }
    const type = getType(c.typeId);
    const rarity = RARITIES[type.rarity];
    const known = type.id !== 'inconnu';
    const n = known ? typeCount[type.id] || 0 : 0;
    const R = REPEAT_FACTORS[Math.min(n, REPEAT_FACTORS.length - 1)];
    const Q = isExcellent(c) ? 1.2 : 1;
    const reg = normReg(c.registration);
    const regSeen = reg && regs.has(reg);
    const bonus = known && n === 0 ? NEW_TYPE_BONUS : 0;

    const place = Number.isFinite(c.placePoints) ? c.placePoints : PLACE_POINTS;
    let points = Math.round((rarity.points + place) * Q * R) + bonus;
    if (regSeen) points = 0;

    out.set(c.id, {
      ...c,
      points,
      breakdown: { aircraft: rarity.points, place, Q, R, bonus, regSeen: !!regSeen, repeat: n },
    });
    if (known) typeCount[type.id] = n + 1;
    if (reg) regs.add(reg);
  }
  return list.map((c) => out.get(c.id));
}

/* ---------- Niveaux ---------- */
const LEVELS = [
  [0, 'Novice du tarmac'],
  [10, 'Observateur'],
  [30, 'Spotteur'],
  [60, 'Spotteur confirmé'],
  [110, 'Chasseur de ciel'],
  [180, 'Chasseur expert'],
  [280, 'As du spotting'],
  [420, 'Commandant de bord'],
  [600, 'Maître de la flotte'],
  [850, 'Légende du ciel'],
];

export function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
  const [floor, title] = LEVELS[i];
  const next = LEVELS[i + 1];
  return {
    level: i + 1,
    title,
    floor,
    next: next ? next[0] : null,
    progress: next ? (xp - floor) / (next[0] - floor) : 1,
  };
}

/* ---------- Statistiques ---------- */
export function computeStats(list) {
  const valid = list.filter((c) => c.valid);
  const types = new Set(valid.filter((c) => c.typeId && c.typeId !== 'inconnu').map((c) => c.typeId));
  const makers = new Set([...types].map((id) => getType(id).maker));
  const places = new Set(valid.map((c) => nearestAirport(c.latitude, c.longitude)?.code).filter(Boolean));
  const days = new Set(valid.map((c) => c.takenAt.slice(0, 10)));
  const byRarity = Object.fromEntries(Object.keys(RARITIES).map((k) => [k, 0]));
  for (const c of valid) byRarity[getType(c.typeId).rarity]++;
  const typesByRarity = Object.fromEntries(Object.keys(RARITIES).map((k) => [k, 0]));
  for (const id of types) typesByRarity[getType(id).rarity]++;
  const best = valid.reduce((b, c) => (!b || c.points > b.points ? c : b), null);
  const xp = list.reduce((s, c) => s + (c.points || 0), 0);

  return {
    xp,
    total: list.length,
    valid: valid.length,
    refused: list.length - valid.length,
    unknown: valid.filter((c) => !c.typeId || c.typeId === 'inconnu').length,
    types: types.size,
    catalogSize: AIRCRAFT.length,
    makers: makers.size,
    places: places.size,
    days: days.size,
    streak: longestStreak([...days]),
    excellent: valid.filter(isExcellent).length,
    byRarity,
    typesByRarity,
    best,
    successRate: list.length ? valid.length / list.length : 0,
  };
}

function longestStreak(days) {
  if (!days.length) return 0;
  const sorted = days.sort();
  let best = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
    cur = diff === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

/* ---------- Succès ---------- */
export const ACHIEVEMENTS = [
  { id: 'first', icon: '📸', title: 'Premier contact', desc: 'Valider ta première capture', test: (s) => s.valid >= 1 },
  { id: 'ten', icon: '🛫', title: 'Dix au compteur', desc: 'Valider 10 captures', test: (s) => s.valid >= 10, goal: (s) => [s.valid, 10] },
  { id: 'fifty', icon: '🛬', title: 'Pilier du tarmac', desc: 'Valider 50 captures', test: (s) => s.valid >= 50, goal: (s) => [s.valid, 50] },
  { id: 'types5', icon: '🗂️', title: 'Petite flotte', desc: 'Collectionner 5 types différents', test: (s) => s.types >= 5, goal: (s) => [s.types, 5] },
  { id: 'types15', icon: '📚', title: 'Grande flotte', desc: 'Collectionner 15 types différents', test: (s) => s.types >= 15, goal: (s) => [s.types, 15] },
  { id: 'makers3', icon: '🏭', title: 'Tour des constructeurs', desc: 'Capturer 3 constructeurs différents', test: (s) => s.makers >= 3, goal: (s) => [s.makers, 3] },
  { id: 'rare', icon: '💎', title: 'Œil de lynx', desc: 'Capturer un appareil rare', test: (s) => s.byRarity.rare + s.byRarity.epique + s.byRarity.legendaire >= 1 },
  { id: 'epic', icon: '🔮', title: 'Moment épique', desc: 'Capturer un appareil épique', test: (s) => s.byRarity.epique + s.byRarity.legendaire >= 1 },
  { id: 'legend', icon: '👑', title: 'Légende vivante', desc: 'Capturer un appareil légendaire', test: (s) => s.byRarity.legendaire >= 1 },
  { id: 'perfect', icon: '✨', title: 'Cliché parfait', desc: 'Réussir une photo excellente (×1,2)', test: (s) => s.excellent >= 1 },
  { id: 'places3', icon: '🧭', title: 'Globe-trotteur', desc: 'Capturer près de 3 aéroports', test: (s) => s.places >= 3, goal: (s) => [s.places, 3] },
  { id: 'streak3', icon: '🔥', title: 'En série', desc: 'Capturer 3 jours de suite', test: (s) => s.streak >= 3, goal: (s) => [s.streak, 3] },
];

export function achievementState(stats) {
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: a.test(stats), progress: a.goal ? a.goal(stats) : null }));
}
