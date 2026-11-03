// Catalogue du prototype : types d'avions, niveaux de rareté et aéroports de référence.
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
  militaire: 'Militaires',
};

// [id, nom, constructeur, catégorie, rareté]
const RAW = [
  // Avions de ligne
  ['a220-100', 'A220-100', 'Airbus', 'ligne', 'peuCommun'],
  ['a220-300', 'A220-300', 'Airbus', 'ligne', 'commun'],
  ['a319', 'A319', 'Airbus', 'ligne', 'commun'],
  ['a320', 'A320', 'Airbus', 'ligne', 'commun'],
  ['a321', 'A321', 'Airbus', 'ligne', 'commun'],
  ['a330', 'A330', 'Airbus', 'ligne', 'peuCommun'],
  ['a350', 'A350', 'Airbus', 'ligne', 'peuCommun'],
  ['a380', 'A380', 'Airbus', 'ligne', 'rare'],
  ['b737-700', '737-700', 'Boeing', 'ligne', 'commun'],
  ['b737-800', '737-800', 'Boeing', 'ligne', 'commun'],
  ['b737-max8', '737 MAX 8', 'Boeing', 'ligne', 'commun'],
  ['b737-classic', '737 Classique (-200 à -500)', 'Boeing', 'ligne', 'rare'],
  ['b757', '757', 'Boeing', 'ligne', 'peuCommun'],
  ['b767', '767', 'Boeing', 'ligne', 'peuCommun'],
  ['b777', '777', 'Boeing', 'ligne', 'peuCommun'],
  ['b787', '787 Dreamliner', 'Boeing', 'ligne', 'peuCommun'],
  ['b747-400', '747-400', 'Boeing', 'ligne', 'rare'],
  ['e175', 'E175', 'Embraer', 'ligne', 'commun'],
  ['e190', 'E190 / E195', 'Embraer', 'ligne', 'commun'],
  ['crj200', 'CRJ200', 'Bombardier', 'ligne', 'commun'],
  ['crj900', 'CRJ700 / CRJ900', 'Bombardier', 'ligne', 'commun'],
  // Régionaux et turbopropulseurs
  ['dash8-100', 'Dash 8-100/200', 'De Havilland Canada', 'regional', 'peuCommun'],
  ['dash8-300', 'Dash 8-300', 'De Havilland Canada', 'regional', 'peuCommun'],
  ['dash8-400', 'Dash 8-400', 'De Havilland Canada', 'regional', 'commun'],
  ['dash7', 'Dash 7', 'De Havilland Canada', 'regional', 'rare'],
  ['jetstream', 'Jetstream 31/32', 'British Aerospace', 'regional', 'rare'],
  ['dornier', 'Dornier 228 / 328', 'Dornier', 'regional', 'rare'],
  ['hs748', 'HS 748', 'Hawker Siddeley', 'regional', 'epique'],
  ['atr42', 'ATR 42', 'ATR', 'regional', 'peuCommun'],
  ['atr72', 'ATR 72', 'ATR', 'regional', 'peuCommun'],
  ['saab340', 'Saab 340', 'Saab', 'regional', 'peuCommun'],
  ['b1900', 'Beechcraft 1900', 'Beechcraft', 'regional', 'peuCommun'],
  ['metro', 'Metroliner', 'Fairchild', 'regional', 'rare'],
  ['twin-otter', 'Twin Otter', 'De Havilland Canada', 'regional', 'peuCommun'],
  // Cargos et gros porteurs
  ['b747-8f', '747-8F', 'Boeing', 'cargo', 'rare'],
  ['b777f', '777F', 'Boeing', 'cargo', 'rare'],
  ['md11', 'MD-11', 'McDonnell Douglas', 'cargo', 'rare'],
  ['f28', 'Fokker F28', 'Fokker', 'ligne', 'rare'],
  ['bae146', 'BAe 146 / Avro RJ', 'British Aerospace', 'ligne', 'rare'],
  ['an124', 'An-124 Ruslan', 'Antonov', 'cargo', 'epique'],
  ['beluga-xl', 'BelugaXL', 'Airbus', 'cargo', 'epique'],
  // Aviation d'affaires
  ['pc12', 'PC-12', 'Pilatus', 'affaires', 'commun'],
  ['king-air', 'King Air', 'Beechcraft', 'affaires', 'commun'],
  ['citation', 'Citation', 'Cessna', 'affaires', 'commun'],
  ['challenger', 'Challenger 350 / 650', 'Bombardier', 'affaires', 'peuCommun'],
  ['global', 'Global 6000 / 7500', 'Bombardier', 'affaires', 'rare'],
  ['learjet', 'Learjet', 'Bombardier', 'affaires', 'peuCommun'],
  ['g650', 'Gulfstream G650', 'Gulfstream', 'affaires', 'rare'],
  ['falcon', 'Falcon (Dassault)', 'Dassault', 'affaires', 'peuCommun'],
  ['phenom', 'Phenom / Praetor / Legacy', 'Embraer', 'affaires', 'peuCommun'],
  ['pc24', 'PC-24', 'Pilatus', 'affaires', 'rare'],
  // Aviation générale et brousse
  ['c172', 'Cessna 172', 'Cessna', 'general', 'commun'],
  ['pa28', 'Piper PA-28', 'Piper', 'general', 'commun'],
  ['caravan', 'Cessna Caravan', 'Cessna', 'general', 'commun'],
  ['beaver', 'DHC-2 Beaver', 'De Havilland Canada', 'general', 'peuCommun'],
  ['otter', 'DHC-3 Otter', 'De Havilland Canada', 'general', 'rare'],
  // Missions spéciales
  ['cl415', 'CL-415 / DHC-515 (bombardier d’eau)', 'Canadair / De Havilland', 'special', 'rare'],
  ['dc3', 'DC-3 / C-47', 'Douglas', 'special', 'epique'],
  ['at802', 'Air Tractor AT-802', 'Air Tractor', 'special', 'rare'],
  ['electra', 'L-188 Electra (bombardier d’eau)', 'Lockheed', 'special', 'epique'],
  ['convair', 'Convair 340/440/580', 'Convair', 'special', 'epique'],
  // Militaires
  ['c130', 'C-130 Hercules', 'Lockheed Martin', 'militaire', 'rare'],
  ['c17', 'C-17 Globemaster III', 'Boeing', 'militaire', 'epique'],
  ['a330mrtt', 'A330 MRTT (CC-330 Husky)', 'Airbus', 'militaire', 'epique'],
  ['f18', 'F/A-18 Hornet (CF-18)', 'Boeing', 'militaire', 'epique'],
  ['f35', 'F-35 Lightning II', 'Lockheed Martin', 'militaire', 'epique'],
  ['f22', 'F-22 Raptor', 'Lockheed Martin', 'militaire', 'legendaire'],
  ['b2', 'B-2 Spirit', 'Northrop Grumman', 'militaire', 'legendaire'],
  ['u2', 'U-2 Dragon Lady', 'Lockheed', 'militaire', 'legendaire'],
];

export const AIRCRAFT = RAW.map(([id, name, maker, category, rarity]) => ({ id, name, maker, category, rarity }));
export const AIRCRAFT_BY_ID = Object.fromEntries(AIRCRAFT.map((a) => [a.id, a]));

/** Type spécial pour une capture valide dont le joueur ne connaît pas le modèle. */
export const UNKNOWN = { id: 'inconnu', name: 'Avion mystère', maker: 'À identifier', category: null, rarity: 'commun' };

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
