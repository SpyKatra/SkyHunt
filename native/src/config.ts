/**
 * Seuils de validation du prototype.
 * Ils sont volontairement visibles dans l'app (panneau « Diagnostic ») pour
 * être ajustés après les tests sur le terrain à YQB / YUL.
 */
export const VALIDATION = {
  /** Confiance minimale du modèle pour dire « c'est un avion » (0–1). */
  minConfidence: 0.5,
  /** Plus grande dimension de l'avion / dimension correspondante de l'image (0–1). */
  minSizeRatio: 0.15,
  /** Score de netteté minimal (variance du laplacien sur la zone de l'avion). */
  minSharpness: 60,
  /** Luminosité moyenne acceptable de la zone de l'avion (0–255). */
  minBrightness: 25,
  maxBrightness: 235,
};

/** Analyse de la caméra : nombre d'images analysées par seconde. */
export const DETECTION_FPS = 5;

/** Taille d'entrée du modèle EfficientDet-Lite0. */
export const MODEL_INPUT = 320;

/**
 * Indice de la classe « airplane » dans les sorties du modèle COCO
 * (indices commençant à 0 : 0 = person, 1 = bicycle, 2 = car, 3 = motorcycle, 4 = airplane).
 */
export const AIRPLANE_CLASS = 4;

/** Points provisoires du prototype (l'identification du type viendra côté serveur). */
export const PROTOTYPE_POINTS = 2;
