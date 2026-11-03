// Règles de validation et messages au joueur (mêmes règles que native/src/validation.ts).
export function checkDetection(d, t) {
  if (!d) return { ok: false, message: 'Analyse en cours…', reasons: ['Pas encore d’analyse'] };
  if (!d.found || d.confidence < t.minConfidence) {
    return { ok: false, message: 'Aucun avion détecté', reasons: ['Aucun avion reconnu'] };
  }
  const reasons = [];
  let message = 'Avion identifiable — capture !';
  if (d.sizeRatio < t.minSizeRatio) {
    reasons.push(`Avion trop petit (${Math.round(d.sizeRatio * 100)} % < ${Math.round(t.minSizeRatio * 100)} %)`);
    message = 'Trop loin — rapproche-toi';
  }
  if (d.sharpness < t.minSharpness) {
    reasons.push(`Photo floue (netteté ${Math.round(d.sharpness)} < ${t.minSharpness})`);
    if (reasons.length === 1) message = 'Image floue — stabilise le téléphone';
  }
  if (d.brightness < t.minBrightness) {
    reasons.push('Avion trop sombre (contre-jour ?)');
    if (reasons.length === 1) message = 'Trop sombre — évite le contre-jour';
  } else if (d.brightness > t.maxBrightness) {
    reasons.push('Image surexposée');
    if (reasons.length === 1) message = 'Trop lumineux';
  }
  return { ok: reasons.length === 0, message, reasons };
}
