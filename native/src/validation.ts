import { VALIDATION } from './config';
import type { CheckResult, Detection } from './types';

/** Applique les règles de validation à la dernière détection. */
export function checkDetection(d: Detection | null): CheckResult {
  if (d == null) {
    return { ok: false, message: 'Analyse en cours…', reasons: ['Pas encore d’analyse'] };
  }
  if (!d.found || d.confidence < VALIDATION.minConfidence) {
    return { ok: false, message: 'Aucun avion détecté', reasons: ['Aucun avion reconnu'] };
  }

  const reasons: string[] = [];
  let message = 'Avion identifiable — capture !';

  if (d.sizeRatio < VALIDATION.minSizeRatio) {
    reasons.push(`Avion trop petit (${Math.round(d.sizeRatio * 100)} % < ${Math.round(VALIDATION.minSizeRatio * 100)} %)`);
    message = 'Trop loin — zoome ou rapproche-toi';
  }
  if (d.sharpness < VALIDATION.minSharpness) {
    reasons.push(`Photo floue (netteté ${Math.round(d.sharpness)} < ${VALIDATION.minSharpness})`);
    if (reasons.length === 1) message = 'Image floue — stabilise le téléphone';
  }
  if (d.brightness < VALIDATION.minBrightness) {
    reasons.push('Avion trop sombre (contre-jour ?)');
    if (reasons.length === 1) message = 'Trop sombre — évite le contre-jour';
  } else if (d.brightness > VALIDATION.maxBrightness) {
    reasons.push('Image surexposée');
    if (reasons.length === 1) message = 'Trop lumineux';
  }

  return { ok: reasons.length === 0, message, reasons };
}
