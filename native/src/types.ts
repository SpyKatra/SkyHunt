/** Résultat de l'analyse d'une image de la caméra (renvoyé par le worklet). */
export type Detection = {
  found: boolean;
  /** Confiance du modèle (0–1). */
  confidence: number;
  /** Boîte normalisée (0–1) dans l'image tournée à l'endroit. */
  box: { x: number; y: number; w: number; h: number } | null;
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

export type CheckResult = {
  ok: boolean;
  /** Message principal affiché au joueur. */
  message: string;
  /** Raisons d'échec (vide si ok). */
  reasons: string[];
};

/** Une capture enregistrée dans le carnet local. */
export type Capture = {
  id: string;
  photoUri: string;
  takenAt: string; // ISO
  latitude: number | null;
  longitude: number | null;
  /** Précision GPS en mètres. */
  accuracy: number | null;
  /** Android : position fournie par une app de position fictive. */
  mockedLocation: boolean;
  confidence: number;
  sizeRatio: number;
  sharpness: number;
  brightness: number;
  valid: boolean;
  reasons: string[];
  points: number;
};
