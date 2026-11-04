// Lecture automatique de l'immatriculation sur la photo (Tesseract.js, sur le téléphone).
/* global Tesseract */
import { extractCandidates, loadRegistry } from './registry.js';

export { extractCandidates };

let workerPromise = null;
const abs = (p) => new URL(p, location.href).href;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract/lang'),
        gzip: true,
        workerBlobURL: false,
      });
      await w.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        tessedit_pageseg_mode: '11', // texte épars
        user_defined_dpi: '300',
      });
      return w;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Précharge le moteur (à appeler au démarrage de la caméra). */
export function warmUpOcr() {
  getWorker().catch(() => {});
  loadRegistry();
}

/**
 * Prépare l'image : zone de l'avion (+ marge), agrandie, en niveaux de gris contrastés.
 * box : {x,y,w,h} normalisés, ou null pour l'image entière.
 */
async function prepare(blob, box, invert) {
  const bmp = await createImageBitmap(blob);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (box) {
    const mx = box.w * 0.06, my = box.h * 0.15;
    sx = Math.max(0, (box.x - mx) * bmp.width);
    sy = Math.max(0, (box.y - my) * bmp.height);
    sw = Math.min(bmp.width - sx, (box.w + 2 * mx) * bmp.width);
    sh = Math.min(bmp.height - sy, (box.h + 2 * my) * bmp.height);
  }
  // Largeur cible ~2000 px : les lettres de l'immatriculation doivent faire 25 px et plus.
  const scale = Math.min(3, 2000 / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  bmp.close && bmp.close();

  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let min = 255, max = 0;
  const g = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g[j] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(1, max - min);
  // Contraste étiré, puis seuil d'Otsu : lettres nettes en noir sur blanc.
  const hist = new Array(256).fill(0);
  for (let j = 0; j < g.length; j++) { g[j] = ((g[j] - min) * 255) / span; hist[g[j]]++; }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = g[j] > thr ? 255 : 0;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Lit l'immatriculation sur la photo. Renvoie { registration, score, text, ms } ou null.
 * Deux passes : texte foncé sur fond clair, puis inversé si rien n'est trouvé.
 */
export async function readRegistration(blob, box) {
  const t0 = performance.now();
  const worker = await getWorker();
  let allText = '';
  for (const invert of [false, true]) {
    const canvas = await prepare(blob, box, invert);
    const { data } = await worker.recognize(canvas);
    allText += `${data.text}\n`;
    const cands = await extractCandidates(data.text);
    if (cands.length && cands[0].score >= 40) {
      return { registration: cands[0].reg, score: cands[0].score, candidates: cands, text: allText, ms: performance.now() - t0 };
    }
  }
  const cands = await extractCandidates(allText);
  return cands.length
    ? { registration: cands[0].reg, score: cands[0].score, candidates: cands, text: allText, ms: performance.now() - t0 }
    : { registration: null, score: 0, candidates: [], text: allText, ms: performance.now() - t0 };
}
