// Analyse de la PHOTO prise (décision de Spy, 2026-11-05) : plus d'analyse en direct.
//
// Pourquoi : sur Android (Samsung S23), le flux vidéo en direct est en 1440×1080, regroupé (« binning ») et
// lissé : image à l'envers selon l'appareil, faux motif de 4 px du capteur, trame des écrans invisible.
// La photo est à l'endroit, en pleine résolution, identique sur iPhone et Android, et c'est elle qu'on garde.
//
// Étapes (≈ 0,5 s) :
//  1. Photo réduite en 320×320 (déformée, comme le web) → EfficientDet-Lite0 → avion, cadre, écran voisin.
//  2. Netteté (variance du laplacien) et luminosité sur la zone de l'avion (image 320×320).
//  3. Moiré : 3 carrés de 128 px à PLEINE résolution au centre de l'avion → web/screen.js → médiane.
// Les images intermédiaires passent par expo-image-manipulator (qui les écrit à l'endroit) et sont lues
// en pixels bruts par react-native-nitro-image.
import { Asset } from 'expo-asset';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Images } from 'react-native-nitro-image';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';
import { AIRPLANE_CLASS, MODEL_INPUT } from './config';
import { analyzePatch, findScreenObject, PATCH } from './shared';
import type { Detection } from './types';

/** Résultat de l'analyse : la détection (mêmes champs que l'ancienne analyse en direct) + détails du moiré. */
export type PhotoAnalysis = Detection & {
  /** Moiré de chacun des 3 carrés (dB) et leurs pics, pour le diagnostic. */
  moireAll: number[];
  photoInfo: string;
};

/* ---------------- Modèle (chargé une seule fois) ---------------- */
let modelPromise: Promise<TensorflowModel> | null = null;

/**
 * Charge le modèle embarqué. Dans l'app Android compilée, `require()` donne un nom de ressource
 * que fast-tflite ne sait pas ouvrir (il attend une URL) : expo-asset copie d'abord le modèle
 * dans un fichier, puis on passe son chemin file://.
 */
export function loadDetector(): Promise<TensorflowModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const asset = await Asset.fromModule(require('../assets/models/efficientdet.tflite')).downloadAsync();
      const url = asset.localUri ?? asset.uri;
      return loadTensorflowModel({ url }, Platform.OS === 'ios' ? ['core-ml'] : []);
    })();
    modelPromise.catch(() => { modelPromise = null; }); // nouvel essai à la prochaine photo
  }
  return modelPromise;
}

/* ---------------- Pixels ---------------- */
/** Position de R, G, B dans chaque pixel selon le format de react-native-nitro-image. */
const ORDER: Record<string, [number, number, number]> = {
  RGBA: [0, 1, 2], RGBX: [0, 1, 2], RGB: [0, 1, 2],
  BGRA: [2, 1, 0], BGRX: [2, 1, 0], BGR: [2, 1, 0],
  ARGB: [1, 2, 3], XRGB: [1, 2, 3],
  ABGR: [3, 2, 1], XBGR: [3, 2, 1],
};

/** Lit une image PNG (sans perte : pas d'artefacts JPEG dans le moiré) en RGB serré (3 octets / pixel). */
async function rgbOf(uri: string): Promise<{ rgb: Uint8Array; w: number; h: number }> {
  const img = await Images.loadFromFileAsync(uri.replace(/^file:\/\//, ''));
  const raw = await img.toRawPixelDataAsync();
  const src = new Uint8Array(raw.buffer);
  const bpp = raw.pixelFormat === 'RGB' || raw.pixelFormat === 'BGR' ? 3 : 4;
  const [ir, ig, ib] = ORDER[raw.pixelFormat] ?? [0, 1, 2];
  const w = raw.width;
  const h = raw.height;
  const rowBytes = Math.round(src.length / h); // peut contenir du remplissage
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * rowBytes + x * bpp;
      const d = (y * w + x) * 3;
      rgb[d] = src[s + ir];
      rgb[d + 1] = src[s + ig];
      rgb[d + 2] = src[s + ib];
    }
  }
  return { rgb, w, h };
}

/* ---------------- Analyse ---------------- */
export async function analyzePhoto(photoUri: string): Promise<PhotoAnalysis> {
  const t0 = Date.now();
  const model = await loadDetector();
  const S = MODEL_INPUT;

  // Dimensions de la photo à l'endroit (orientation EXIF appliquée).
  const upright = await ImageManipulator.manipulate(photoUri).renderAsync();
  const W = upright.width;
  const H = upright.height;

  // 1. Image 320×320 pour le modèle.
  const small = await ImageManipulator.manipulate(photoUri).resize({ width: S, height: S }).renderAsync();
  const smallFile = await small.saveAsync({ format: SaveFormat.PNG });
  const { rgb, w: sw, h: sh } = await rgbOf(smallFile.uri);
  if (sw !== S || sh !== S) throw new Error(`image réduite en ${sw}×${sh} au lieu de ${S}×${S}`);
  const out = await model.run([rgb.buffer as ArrayBuffer]);
  const boxes = new Float32Array(out[0]);
  const classes = new Float32Array(out[1]);
  const scores = new Float32Array(out[2]);
  const count = Math.min(Math.round(new Float32Array(out[3])[0] ?? 0), scores.length);
  const detectMs = Date.now() - t0;

  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < count; i++) {
    if (Math.round(classes[i]) === AIRPLANE_CLASS && scores[i] > bestScore) {
      best = i;
      bestScore = scores[i];
    }
  }
  const base = { aspect: W / H, detectMs, frameInfo: `photo ${W}×${H}` };
  if (best < 0) {
    return {
      found: false, confidence: 0, box: null, sizeRatio: 0, sharpness: 0, brightness: 0, moire: 0,
      screenObject: 0, screenClass: -1, inferenceMs: Date.now() - t0, moireMs: -1, moireAll: [], photoInfo: '', ...base,
    };
  }

  // Cadre [ymin, xmin, ymax, xmax] normalisé 0–1, image à l'endroit.
  const ymin = Math.max(0, boxes[best * 4]);
  const xmin = Math.max(0, boxes[best * 4 + 1]);
  const ymax = Math.min(1, boxes[best * 4 + 2]);
  const xmax = Math.min(1, boxes[best * 4 + 3]);
  const w = xmax - xmin;
  const h = ymax - ymin;

  // 2. Netteté et luminosité sur la zone de l'avion.
  const x0 = Math.max(1, Math.floor(xmin * S));
  const x1 = Math.min(S - 2, Math.ceil(xmax * S));
  const y0 = Math.max(1, Math.floor(ymin * S));
  const y1 = Math.min(S - 2, Math.ceil(ymax * S));
  const gray = (k: number) => 0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2];
  let sum = 0;
  let sumSq = 0;
  let lum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = (y * S + x) * 3;
      const c = gray(k);
      const lap = gray(k - 3) + gray(k + 3) + gray(k - S * 3) + gray(k + S * 3) - 4 * c;
      sum += lap;
      sumSq += lap * lap;
      lum += c;
      n++;
    }
  }
  const mean = n > 0 ? sum / n : 0;
  const sharpness = n > 0 ? sumSq / n - mean * mean : 0;
  const brightness = n > 0 ? lum / n : 0;

  // Écran (télé, portable, téléphone) autour de l'avion.
  const scr = findScreenObject(boxes, classes, scores, count, xmin, ymin, xmax, ymax);

  // 3. Moiré : bande de 3 carrés de 128 px côte à côte, au centre de l'avion, à pleine résolution.
  const tm = Date.now();
  let moire = 0;
  let moirePeaks = '';
  let moireAll: number[] = [];
  let photoInfo = '';
  try {
    const bw = Math.min(W, PATCH * 3);
    const cx = ((xmin + xmax) / 2) * W;
    const cy = ((ymin + ymax) / 2) * H;
    const ox = Math.round(Math.min(W - bw, Math.max(0, cx - bw / 2)));
    const oy = Math.round(Math.min(H - PATCH, Math.max(0, cy - PATCH / 2)));
    const strip = await ImageManipulator.manipulate(photoUri).crop({ originX: ox, originY: oy, width: bw, height: PATCH }).renderAsync();
    const stripFile = await strip.saveAsync({ format: SaveFormat.PNG });
    const px = await rgbOf(stripFile.uri);
    const results: { moire: number; peaks: string }[] = [];
    for (let k = 0; k * PATCH + PATCH <= px.w && k < 3; k++) {
      const patch = new Uint8Array(PATCH * PATCH * 3);
      for (let y = 0; y < PATCH; y++) {
        patch.set(px.rgb.subarray((y * px.w + k * PATCH) * 3, (y * px.w + k * PATCH + PATCH) * 3), y * PATCH * 3);
      }
      results.push(analyzePatch(patch, PATCH));
    }
    // Médiane : un écran couvre tout l'avion (les 3 carrés), un reflet ou un détail périodique rarement.
    const sorted = results.slice().sort((a, b) => a.moire - b.moire);
    const med = sorted[(sorted.length - 1) >> 1];
    moire = med ? med.moire : 0;
    moirePeaks = med ? med.peaks : '';
    moireAll = results.map((r) => Math.round(r.moire));
    photoInfo = `${W}×${H} · carrés à ${ox},${oy}`;
  } catch (e) {
    photoInfo = `moiré : ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`;
  }

  return {
    found: true,
    confidence: bestScore,
    box: { x: xmin, y: ymin, w, h },
    sizeRatio: Math.max(w, h),
    sharpness,
    brightness,
    moire,
    moirePeaks,
    moireAll,
    photoInfo,
    screenObject: scr.score,
    screenClass: scr.cls,
    inferenceMs: Date.now() - t0,
    moireMs: Date.now() - tm,
    ...base,
  };
}
