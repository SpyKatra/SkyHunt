// Appareils militaires : avertissement à accepter avant qu'une capture compte (document de projet, « Vols militaires »).
// Sans DOM : partagé avec l'app native (native/src/shared.ts).
//
// ⚠ LISTES PROVISOIRES, à faire valider par un juriste avant la publication. Elles ne sont qu'un garde-fou :
// le joueur reste responsable de respecter les lois du pays où il se trouve.

/** Pays où photographier un appareil militaire est interdit ou très risqué : capture militaire désactivée. */
export const MILITARY_FORBIDDEN = new Set(['RU', 'BY', 'CN', 'KP', 'IR', 'SY', 'EG', 'AE', 'SA', 'UA']);
/** Pays avec restrictions connues : avertissement à accepter à chaque capture. */
export const MILITARY_RESTRICTED = new Set(['GR', 'TR', 'CY', 'IL', 'IN', 'PK', 'VN', 'CU', 'MA', 'DZ', 'QA', 'JO', 'KZ']);

/** 'interdit' | 'restreint' | 'libre' selon le pays (code ISO, null = inconnu → 'restreint' par prudence). */
export function militaryPolicy(country) {
  const cc = (country || '').toUpperCase();
  if (MILITARY_FORBIDDEN.has(cc)) return 'interdit';
  if (!cc || MILITARY_RESTRICTED.has(cc)) return 'restreint';
  return 'libre';
}

export const MILITARY_WARNING = 'Appareil militaire détecté. Dans certains pays, photographier un appareil ou une installation '
  + 'militaire est interdit et peut entraîner une arrestation ou la saisie de ton téléphone. Reste dans un lieu public, '
  + 'n’entre jamais dans une zone réglementée et respecte les panneaux et les consignes du personnel. '
  + 'Tu es responsable de respecter les lois locales.';

export const MILITARY_FORBIDDEN_TEXT = 'Les captures d’appareils militaires sont désactivées dans ce pays : '
  + 'les photographier y est interdit ou très risqué. La carte ne sera pas enregistrée comme appareil militaire.';

/** Consigne de sécurité générale, montrée au premier lancement de la caméra. */
export const SAFETY_VERSION = 1;
export const SAFETY_TEXT = [
  'Photographie toujours depuis un lieu public ou un endroit où tu as le droit d’être.',
  'N’entre jamais dans une zone réglementée d’aéroport ou militaire, et ne franchis aucune clôture.',
  'Respecte les panneaux et les consignes du personnel et des agents de sécurité.',
  'Ne fais jamais voler de drone près d’un aéroport, et ne vise jamais un avion avec un laser.',
  'Certains pays interdisent de photographier les appareils et installations militaires : renseigne-toi avant.',
];

// Acceptation « une fois par session » (pays sans restriction) : gardée en mémoire jusqu'à la fermeture de l'app.
let sessionAck = null;

/**
 * Faut-il demander l'avertissement ? Renvoie { ask: false, ackAt } si déjà accepté pour cette session,
 * { ask: true, policy } sinon, ou { blocked: true } si interdit.
 */
export function militaryGate(country) {
  const policy = militaryPolicy(country);
  if (policy === 'interdit') return { blocked: true, policy };
  if (policy === 'libre' && sessionAck) return { ask: false, ackAt: new Date().toISOString(), policy };
  return { ask: true, policy };
}

/** À appeler quand le joueur accepte l'avertissement ; renvoie la date d'acceptation à garder dans la capture. */
export function acceptMilitary() {
  sessionAck = new Date().toISOString();
  return sessionAck;
}
