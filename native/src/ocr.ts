// Lecture de l'immatriculation sur la photo, avec la reconnaissance de texte du téléphone
// (Apple Vision sur iPhone, Google ML Kit sur Android) via expo-text-extractor.
// Les candidats sont ensuite triés par les mêmes règles que la version web (shared.extractCandidates).
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { extractTextFromImage, isSupported } from 'expo-text-extractor';
import { extractCandidates } from './shared';
import type { Box } from './types';

export type OcrResult = { registration: string | null; score: number; text: string; ms: number; errors: string[] };

/**
 * Recadre la zone de l'avion (+ marge) et l'agrandit si besoin. Le recadrage écrit aussi l'image
 * « à l'endroit » : Apple Vision ignore l'orientation EXIF des photos.
 */
async function prepare(uri: string, box: Box | null): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  const upright = await ctx.renderAsync();
  const W = upright.width;
  const H = upright.height;
  const img = ImageManipulator.manipulate(uri);
  if (box) {
    const mx = box.w * 0.08;
    const my = box.h * 0.2;
    const x = Math.max(0, (box.x - mx) * W);
    const y = Math.max(0, (box.y - my) * H);
    const w = Math.min(W - x, (box.w + 2 * mx) * W);
    const h = Math.min(H - y, (box.h + 2 * my) * H);
    if (w > 32 && h > 32) {
      img.crop({ originX: Math.round(x), originY: Math.round(y), width: Math.round(w), height: Math.round(h) });
      // Lettres d'au moins ~25 px : on vise ~2000 px de large.
      if (w < 1400) img.resize({ width: Math.round(Math.min(3, 2000 / w) * w) });
    }
  }
  const out = await (await img.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
  return out.uri;
}

async function readText(uri: string): Promise<string> {
  const lines = await extractTextFromImage(uri);
  return lines.join('\n');
}

/** Message d'erreur complet (code Expo + cause) pour le diagnostic. */
function errText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as { code?: string }).code;
  return `${code ? `[${code}] ` : ''}${e.message}`.slice(0, 220);
}

/**
 * Bandes verticales de la zone de l'avion (3, qui se chevauchent) : chacune est agrandie à ~2000 px,
 * les lettres d'une petite immatriculation (cargo, aviation légère) deviennent ~2 fois plus grandes.
 */
function strips(box: Box): Box[] {
  const w = box.w * 0.4;
  return [0, 0.3, 0.6].map((f) => ({ x: box.x + box.w * f, y: box.y, w, h: box.h }));
}

/**
 * Lit l'immatriculation : zone de l'avion, puis bandes agrandies de cette zone, puis toute la photo,
 * puis la photo d'origine telle quelle (sans passer par ImageManipulator).
 * Une zone qui échoue n'arrête pas les suivantes : les erreurs sont gardées, étiquetées par étape
 * (« préparation » = recadrage par ImageManipulator, « lecture » = ML Kit / Apple Vision).
 * Diagnostic du plantage « getClass() on a null object reference » vu sur Samsung S23 (2026-11-05).
 */
export async function readRegistration(photoUri: string, box: Box | null): Promise<OcrResult> {
  const t0 = Date.now();
  if (!isSupported) return { registration: null, score: 0, text: '', ms: 0, errors: ['lecture de texte non prise en charge'] };
  let allText = '';
  const errors: string[] = [];
  const zones: { name: string; zone: Box | null | 'original' }[] = [
    ...(box ? [{ name: 'avion', zone: box }, ...strips(box).map((z, i) => ({ name: `bande ${i + 1}`, zone: z }))] : []),
    { name: 'photo', zone: null },
    { name: 'origine', zone: 'original' },
  ];
  for (const { name, zone } of zones) {
    let uri = photoUri;
    if (zone !== 'original') {
      try {
        uri = await prepare(photoUri, zone);
      } catch (e) {
        errors.push(`${name}, préparation : ${errText(e)}`);
        continue;
      }
    }
    let text = '';
    try {
      text = await readText(uri);
    } catch (e) {
      errors.push(`${name}, lecture : ${errText(e)}`);
      continue;
    }
    allText += `${text}\n`;
    const cands = await extractCandidates(text);
    if (cands.length && cands[0].score >= 40) {
      return { registration: cands[0].reg, score: cands[0].score, text: allText, ms: Date.now() - t0, errors };
    }
  }
  const cands = await extractCandidates(allText);
  return cands.length
    ? { registration: cands[0].reg, score: cands[0].score, text: allText, ms: Date.now() - t0, errors }
    : { registration: null, score: 0, text: allText, ms: Date.now() - t0, errors };
}

/**
 * Copie allégée pour le serveur (comme la version web) : JPEG 80 %, 2048 px max.
 * La photo d'origine reste intacte dans l'app.
 */
export async function compressForUpload(uri: string): Promise<string> {
  // Dimensions « à l'endroit » (après l'orientation EXIF).
  const upright = await ImageManipulator.manipulate(uri).renderAsync();
  const img = ImageManipulator.manipulate(uri);
  if (Math.max(upright.width, upright.height) > 2048) {
    if (upright.width >= upright.height) img.resize({ width: 2048 });
    else img.resize({ height: 2048 });
  }
  const out = await (await img.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return out.uri;
}
