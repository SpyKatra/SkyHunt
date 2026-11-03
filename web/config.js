// Seuils de validation — mêmes valeurs que le prototype natif (native/src/config.ts).
// Ils sont réglables en direct dans le panneau « Diagnostic » et mémorisés sur le téléphone.
export const DEFAULT_THRESHOLDS = {
  minConfidence: 0.5, // confiance du modèle (0–1)
  minSizeRatio: 0.15, // plus grande dimension de l'avion / dimension de l'image (0–1)
  minSharpness: 60,   // variance du laplacien sur la zone de l'avion
  minBrightness: 25,  // luminosité moyenne de la zone (0–255)
  maxBrightness: 235,
};

export const DETECTION_INTERVAL_MS = 200; // ~5 analyses par seconde
export const MODEL_INPUT = 320;           // EfficientDet-Lite0
export const AIRPLANE_CLASS = 4;          // COCO, indices à partir de 0 : 4 = airplane
export const PROTOTYPE_POINTS = 2;        // points provisoires par capture valide
