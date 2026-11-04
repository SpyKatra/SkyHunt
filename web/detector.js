// Détection d'avion avec EfficientDet-Lite0 (TFLite), exécuté en WebAssembly dans le navigateur.
// Même modèle et même post-traitement que le prototype natif.
import { AIRPLANE_CLASS, MODEL_INPUT } from './config.js';
import { analyzePatch, findScreenObject, PATCH, pushMedian } from './screen.js';

const S = MODEL_INPUT;

export async function createDetector() {
  /* global tfweb */
  tfweb.tflite_web_api.setWasmPath('vendor/tflite/');
  const buf = await (await fetch('models/efficientdet.tflite')).arrayBuffer();
  const runner = await tfweb.TFLiteWebModelRunner.create(buf, { numThreads: 1 });
  const input = runner.getInputs()[0];

  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = new Uint8Array(S * S * 3);
  // Carré pris à pleine résolution au centre de l'avion (anti-triche « photo d'écran »).
  const pcanvas = document.createElement('canvas');
  pcanvas.width = PATCH;
  pcanvas.height = PATCH;
  const pctx = pcanvas.getContext('2d', { willReadFrequently: true });
  const prgb = new Uint8Array(PATCH * PATCH * 3);
  const moireHist = [];

  /**
   * Analyse l'image actuelle de la vidéo.
   * Renvoie la meilleure détection « avion » + netteté et luminosité de sa zone.
   */
  function detect(video) {
    const t0 = performance.now();

    // 1. Image complète redimensionnée en 320×320 (déformée, comme côté natif).
    ctx.drawImage(video, 0, 0, S, S);
    const rgba = ctx.getImageData(0, 0, S, S).data;
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }

    // 2. Inférence. Sorties : boîtes [25×4], classes [25], scores [25], nombre [1].
    input.data().set(rgb);
    runner.infer();
    const out = runner.getOutputs();
    const boxes = out[0].data();
    const classes = out[1].data();
    const scores = out[2].data();
    const count = Math.min(Math.round(out[3].data()[0] || 0), scores.length);

    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < count; i++) {
      if (Math.round(classes[i]) === AIRPLANE_CLASS && scores[i] > bestScore) {
        best = i;
        bestScore = scores[i];
      }
    }

    if (best < 0) {
      moireHist.length = 0;
      return { found: false, confidence: 0, box: null, sizeRatio: 0, sharpness: 0, brightness: 0,
        moire: 0, screenObject: 0, screenClass: -1,
        inferenceMs: performance.now() - t0 };
    }

    // Boîte [ymin, xmin, ymax, xmax] normalisée 0–1.
    const ymin = Math.max(0, boxes[best * 4]);
    const xmin = Math.max(0, boxes[best * 4 + 1]);
    const ymax = Math.min(1, boxes[best * 4 + 2]);
    const xmax = Math.min(1, boxes[best * 4 + 3]);
    const w = xmax - xmin;
    const h = ymax - ymin;

    // 3. Netteté (variance du laplacien) et luminosité sur la zone de l'avion.
    const { sharpness, brightness } = measureZone(rgb, xmin, ymin, xmax, ymax);

    // 4. Photo d'écran ? Écran détecté autour de l'avion + moiré à pleine résolution.
    const scr = findScreenObject(boxes, classes, scores, count, xmin, ymin, xmax, ymax);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let moire = 0;
    if (vw >= PATCH && vh >= PATCH) {
      const sx = Math.round(Math.min(vw - PATCH, Math.max(0, ((xmin + xmax) / 2) * vw - PATCH / 2)));
      const sy = Math.round(Math.min(vh - PATCH, Math.max(0, ((ymin + ymax) / 2) * vh - PATCH / 2)));
      pctx.drawImage(video, sx, sy, PATCH, PATCH, 0, 0, PATCH, PATCH);
      const p = pctx.getImageData(0, 0, PATCH, PATCH).data;
      for (let i = 0, j = 0; i < p.length; i += 4, j += 3) {
        prgb[j] = p[i];
        prgb[j + 1] = p[i + 1];
        prgb[j + 2] = p[i + 2];
      }
      moire = pushMedian(moireHist, analyzePatch(prgb, PATCH).moire);
    }

    return {
      found: true,
      confidence: bestScore,
      box: { x: xmin, y: ymin, w, h },
      sizeRatio: Math.max(w, h),
      sharpness,
      brightness,
      moire,
      screenObject: scr.score,
      screenClass: scr.cls,
      inferenceMs: performance.now() - t0,
    };
  }

  return { detect };
}

function gray(rgb, k) {
  return 0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2];
}

export function measureZone(rgb, xmin, ymin, xmax, ymax) {
  const x0 = Math.max(1, Math.floor(xmin * S));
  const x1 = Math.min(S - 2, Math.ceil(xmax * S));
  const y0 = Math.max(1, Math.floor(ymin * S));
  const y1 = Math.min(S - 2, Math.ceil(ymax * S));
  const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 120));
  let sum = 0, sumSq = 0, lum = 0, n = 0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const k = (y * S + x) * 3;
      const c = gray(rgb, k);
      const lap = gray(rgb, k - 3) + gray(rgb, k + 3) + gray(rgb, k - S * 3) + gray(rgb, k + S * 3) - 4 * c;
      sum += lap;
      sumSq += lap * lap;
      lum += c;
      n++;
    }
  }
  const mean = n ? sum / n : 0;
  return { sharpness: n ? sumSq / n - mean * mean : 0, brightness: n ? lum / n : 0 };
}
