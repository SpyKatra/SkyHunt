// Catalogue : types d'avions (familles et séries, web/fleet.js), niveaux de rareté et aéroports de référence.
// La rareté suit la grille du document de projet. Plus tard, l'IA côté serveur
// identifiera le type automatiquement ; pour l'instant le joueur le choisit.

export const RARITIES = {
  commun:     { label: 'Commun',     points: 2,  color: '#94a3b8', glow: 'rgba(148,163,184,.55)', order: 0 },
  peuCommun:  { label: 'Peu commun', points: 5,  color: '#22c55e', glow: 'rgba(34,197,94,.6)',    order: 1 },
  rare:       { label: 'Rare',       points: 10, color: '#3b82f6', glow: 'rgba(59,130,246,.65)',  order: 2 },
  epique:     { label: 'Épique',     points: 20, color: '#a855f7', glow: 'rgba(168,85,247,.7)',   order: 3 },
  legendaire: { label: 'Légendaire', points: 30, color: '#f59e0b', glow: 'rgba(245,158,11,.8)',   order: 4 },
};

export const CATEGORIES = {
  ligne: 'Avions de ligne',
  regional: 'Régionaux et turbopropulseurs',
  cargo: 'Cargos et gros porteurs',
  affaires: 'Aviation d’affaires',
  general: 'Aviation générale et brousse',
  special: 'Missions spéciales',
  collection: 'Avions de collection',
  militaire: 'Militaires',
};

import { FAMILIES } from './fleet.js';

// Familles d'avions (web/fleet.js) : chaque famille est une carte, avec ses séries (modèles précis).
export const AIRCRAFT = FAMILIES.map(([id, name, maker, category, rarity, series = []]) => ({
  id, name, maker, category, rarity,
  series: series.map(([key, sname, rule]) => ({ id: `${id}.${key}`, name: sname, rule: rule || null })),
}));
export const AIRCRAFT_BY_ID = Object.fromEntries(AIRCRAFT.map((a) => [a.id, a]));
export const SERIES_BY_ID = Object.fromEntries(AIRCRAFT.flatMap((a) => a.series.map((s) => [s.id, { ...s, typeId: a.id }])));

/** Série (modèle précis) d'après son identifiant « famille.clé », ou null. */
export function getSeries(id) {
  return (id && SERIES_BY_ID[id]) || null;
}

/** La série appartient-elle bien à ce type ? (sinon elle est ignorée) */
export function seriesOf(typeId, seriesId) {
  const s = getSeries(seriesId);
  return s && s.typeId === typeId ? s : null;
}

/** Nom à afficher sur la carte : la série si elle est connue (« 737-900ER »), sinon la famille. */
export function cardName(c) {
  const t = getType(c.typeId);
  const s = seriesOf(t.id, c.seriesId);
  return s ? s.name : t.name;
}

/** Série d'une famille d'après le modèle exact d'un registre (ex. « 737-8H4 » → 737-800), ou null. */
export function matchSeries(typeId, model) {
  const t = AIRCRAFT_BY_ID[typeId];
  const m = (model || '').toUpperCase();
  if (!t || !m) return null;
  const s = t.series.find((x) => x.rule && x.rule.test(m));
  return s ? s.id : null;
}

/** Type spécial pour une capture valide dont le joueur ne connaît pas le modèle. */
export const UNKNOWN = { id: 'inconnu', name: 'Avion mystère', maker: 'À identifier', category: null, rarity: 'commun', series: [] };

export function getType(id) {
  return (id && AIRCRAFT_BY_ID[id]) || UNKNOWN;
}

// Aéroports de référence pour nommer le lieu d'une capture (rayon 15 km).
export const AIRPORTS = [
  ['YQB', 'Québec – Jean-Lesage', 46.7911, -71.3933],
  ['YUL', 'Montréal – Trudeau', 45.4706, -73.7408],
  ['YHU', 'Montréal – Saint-Hubert', 45.5175, -73.4169],
  ['YMX', 'Montréal – Mirabel', 45.6797, -74.0387],
  ['YBG', 'Bagotville', 48.3306, -70.9964],
  ['YRQ', 'Trois-Rivières', 46.3528, -72.6794],
  ['YSC', 'Sherbrooke', 45.4386, -71.6914],
  ['YOW', 'Ottawa', 45.3225, -75.6692],
  ['YYZ', 'Toronto – Pearson', 43.6777, -79.6248],
  ['YVR', 'Vancouver', 49.1939, -123.1844],
  ['YYC', 'Calgary', 51.1215, -114.0076],
  ['YHZ', 'Halifax', 44.8808, -63.5086],
  ['CDG', 'Paris – Charles-de-Gaulle', 49.0097, 2.5479],
  ['ORY', 'Paris – Orly', 48.7262, 2.3652],
  ['LHR', 'Londres – Heathrow', 51.47, -0.4543],
  ['PRG', 'Prague', 50.1008, 14.26],
  ['JFK', 'New York – JFK', 40.6413, -73.7781],
  ['BOS', 'Boston', 42.3656, -71.0096],
  ['PLB', 'Plattsburgh', 44.6509, -73.4681],
];

export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Aéroport le plus proche à moins de 15 km, sinon null. */
export function nearestAirport(lat, lon) {
  if (lat == null || lon == null) return null;
  let best = null;
  for (const [code, name, alat, alon] of AIRPORTS) {
    const d = distanceKm(lat, lon, alat, alon);
    if (d <= 15 && (!best || d < best.km)) best = { code, name, km: d };
  }
  return best;
}
