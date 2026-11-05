/** Résultat de l'analyse d'une image de la caméra (renvoyé par le worklet). */
export type Detection = {
  found: boolean;
  /** Confiance du modèle (0–1). */
  confidence: number;
  /** Boîte normalisée (0–1) dans l'image tournée à l'endroit. */
  box: Box | null;
  /** Plus grande dimension relative de l'avion (0–1). */
  sizeRatio: number;
  /** Variance du laplacien sur la zone de l'avion. */
  sharpness: number;
  /** Luminosité moyenne de la zone (0–255). */
  brightness: number;
  /** Anti-triche : pic du spectre (dB) sur un carré à pleine résolution au centre de l'avion. */
  moire: number;
  /** Anti-triche : confiance d'un écran (télé, portable, téléphone) autour de l'avion (0–1). */
  screenObject: number;
  /** Classe COCO de cet écran (-1 si aucun). */
  screenClass: number;
  /** Diagnostic : confiance « avion » de l'image tournée de 0°, 90°, 180° et 270° (sens horaire), mesurée de temps en temps. */
  rotConf?: number[];
  /** Diagnostic : positions des deux pics du moiré (« Cb u,v u,v », cycles par carré de 128 px). */
  moirePeaks?: string;
  /** Quarts de tour (sens horaire) qui remettent l'image du capteur à l'endroit. */
  rot?: number;
  /** Proportions de l'image tournée à l'endroit (largeur / hauteur). */
  aspect: number;
  /** Durée totale de l'analyse (ms). */
  inferenceMs: number;
  /** Natif : part de la détection (redimensionnement + modèle) et du moiré (ms ; -1 = non mesuré cette fois). */
  detectMs?: number;
  moireMs?: number;
  /** Diagnostic : image reçue (« 1920×1440 right ») et cadence réelle de la caméra. */
  frameInfo?: string;
  cameraFps?: number;
};

export type Box = { x: number; y: number; w: number; h: number };

export type Thresholds = {
  minConfidence: number;
  minSizeRatio: number;
  minSharpness: number;
  minBrightness: number;
  maxBrightness: number;
  maxMoire: number;
  maxScreenObject: number;
};

export type CheckResult = {
  ok: boolean;
  /** Message principal affiché au joueur. */
  message: string;
  /** Raisons d'échec (vide si ok). */
  reasons: string[];
};

/**
 * Une capture du carnet local. Mêmes champs que la version web (web/app.js),
 * sauf la photo : un fichier (photoUri) au lieu d'un Blob.
 * Les points ne sont PAS stockés : ils sont recalculés (shared.recompute).
 */
export type Capture = {
  id: string;
  takenAt: string; // ISO
  /** Photo d'origine dans le dossier de l'app (null si pas encore téléchargée). */
  photoUri: string | null;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Précision GPS en mètres. */
  accuracy: number | null;
  gpsAgeS: number | null;
  confidence: number;
  sizeRatio: number;
  sharpness: number;
  brightness: number;
  moire?: number | null;
  /** Diagnostic : pics du moiré en direct au déclenchement. */
  moirePeaks?: string | null;
  /** Diagnostic : moiré mesuré sur la photo en pleine résolution (pas encore utilisé pour valider). */
  photoMoire?: number | null;
  photoMoirePeaks?: string | null;
  photoMoireInfo?: string | null;
  /** Diagnostic : balises EXIF de la photo (distance du sujet, focale...). */
  exif?: string | null;
  /** Diagnostic : distance de mise au point au déclenchement (voir focusText). */
  focus?: string | null;
  screenObject?: number | null;
  box: Box | null;
  thresholds: Thresholds | null;
  valid: boolean;
  reasons: string[];
  typeId: string | null;
  /** Série précise de la famille (« b737-800.900er »), facultative. */
  seriesId?: string | null;
  registration: string | null;
  registrationSource: string | null;
  registryModel: string | null;
  userAgent: string;
  /** Zoom utilisé (×, relatif à l'objectif principal). */
  zoom?: number | null;

  // Synchronisation (voir src/cloud.ts)
  ownerId?: string;
  syncState?: 'pending' | 'synced';
  rev?: number;
  photoPath?: string | null;
  /** Points de lieu calculés par le serveur (rareté du lieu) ; absent = 1. */
  placePoints?: number;
  /** Jeton de capture à usage unique (anti-triche) : prouve que la photo n'est pas antidatée. */
  captureToken?: string | null;
  /** Avertissement militaire accepté (date, heure) : obligatoire pour qu'une capture militaire compte. */
  militaryAckAt?: string | null;
  /** Photo en double d'une photo déjà envoyée (constaté par le serveur) : 0 point. */
  duplicate?: boolean;
};

export type Breakdown = {
  /** Capture valide qui ne compte pas (double, militaire sans avertissement) : seul ce champ est présent. */
  blocked?: string;
  aircraft: number;
  place: number;
  Q: number;
  R: number;
  bonus: number;
  /** Nouvelle série d'une famille déjà capturée (+2). */
  seriesBonus?: number;
  series?: string | null;
  regSeen: boolean;
  repeat: number;
};

/** Ligne d'un classement (fonction serveur `leaderboard`). */
export type RankRow = { rank: number; pseudo: string; country: string; points: number; captures: number; isMe: boolean };
/** Ami ou demande : pas de pseudo pour une demande envoyée ou refusée (seulement le code tapé). */
export type FriendRow = {
  userId: string; state: 'ami' | 'reçue' | 'envoyée' | 'refusée'; pseudo: string | null; country: string | null; code: string | null;
  /** Demande refusée : relance possible à partir de cette heure (48 h après le refus). */
  retryAt: string | null;
};

/** Capture avec ses points recalculés. */
export type Scored = Capture & { points: number; breakdown: Breakdown | null };

export type Identification = {
  typeId: string;
  seriesId?: string | null;
  registration: string | null;
  registrationSource: string | null;
  registryModel: string | null;
  militaryAckAt?: string | null;
};
