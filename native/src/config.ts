// Réglages du modèle de détection (les seuils de validation sont partagés avec le web :
// web/config.js → DEFAULT_THRESHOLDS, via src/shared.ts).

/** Analyse de la caméra : nombre d'images analysées par seconde. */
export const DETECTION_FPS = 5;

/** Taille d'entrée du modèle EfficientDet-Lite0. */
export const MODEL_INPUT = 320;

/**
 * Indice de la classe « airplane » dans les sorties du modèle COCO
 * (indices commençant à 0 : 0 = person, 1 = bicycle, 2 = car, 3 = motorcycle, 4 = airplane).
 */
export const AIRPLANE_CLASS = 4;
