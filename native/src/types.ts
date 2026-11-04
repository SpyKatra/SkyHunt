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
  /** Proportions de l'image tournée à l'endroit (largeur / hauteur). */
  aspect: number;
  /** Durée d'inférence (ms). */
  inferenceMs: number;
};

export type Box = { x: number; y: number; w: number; h: number };

export type Thresholds = {
  minConfidence: number;
  minSizeRatio: number;
  minSharpness: number;
  minBrightness: number;
  maxBrightness: number;
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
  box: Box | null;
  thresholds: Thresholds | null;
  valid: boolean;
  reasons: string[];
  typeId: string | null;
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
};

export type Breakdown = {
  aircraft: number;
  place: number;
  Q: number;
  R: number;
  bonus: number;
  regSeen: boolean;
  repeat: number;
};

/** Capture avec ses points recalculés. */
export type Scored = Capture & { points: number; breakdown: Breakdown | null };

export type Identification = {
  typeId: string;
  registration: string | null;
  registrationSource: string | null;
  registryModel: string | null;
};
