import { Asset } from 'expo-asset';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import { useFrameProcessor } from 'react-native-vision-camera';
import { useSharedValue, Worklets } from 'react-native-worklets-core';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { AIRPLANE_CLASS, DETECTION_FPS, MODEL_INPUT } from './config';
import { analyzePatch, findScreenObject, PATCH, pushMedian } from './shared';
import type { Detection } from './types';

type Rotation = '0deg' | '90deg' | '180deg' | '270deg';
const ROTATIONS: Rotation[] = ['0deg', '90deg', '180deg', '270deg'];

/**
 * Charge le modèle EfficientDet-Lite0 (COCO) et renvoie un frameProcessor
 * qui cherche le meilleur avion dans l'image, ~5 fois par seconde.
 *
 * `rotationOffset` (0–3) permet de corriger l'orientation si le cadre
 * dessiné ne suit pas l'avion sur ton téléphone (bouton « ↻ » du diagnostic).
 */
export function useAircraftDetector(rotationOffset: number) {
  const model = useModel();
  const loaded = model.state === 'loaded' ? model.model : undefined;
  const boxed = useMemo(() => (loaded != null ? NitroModules.box(loaded) : undefined), [loaded]);

  const { resize } = useResizePlugin();
  const [detection, setDetection] = useState<Detection | null>(null);
  // Côté JS : médiane du moiré sur les 3 dernières analyses (un pic dû au bruit ne suffit pas).
  const moireHist = useRef<number[]>([]);
  const report = useMemo(() => Worklets.createRunOnJS((d: Detection) => {
    if (!d.found) moireHist.current = [];
    else d.moire = pushMedian(moireHist.current, d.moire);
    setDetection(d);
  }), []);
  const lastRun = useSharedValue(0);
  const intervalMs = 1000 / DETECTION_FPS;

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (boxed == null) return;

      // Limite l'analyse à ~5 images/s. Pas de sous-worklet : le plugin Babel
      // détacherait les méthodes de l'objet natif (unbox / runSync).
      const t0 = Date.now();
      if (t0 - lastRun.value < intervalMs) return;
      lastRun.value = t0;
      {
        const tflite = boxed.unbox();

        // 1. Orientation : on remet l'image à l'endroit pour le modèle.
        let base = 0;
        if (frame.orientation === 'landscape-left') base = 1;
        else if (frame.orientation === 'portrait-upside-down') base = 2;
        else if (frame.orientation === 'landscape-right') base = 3;
        const rotIndex = (base + rotationOffset) % 4;
        const rotation = ROTATIONS[rotIndex];
        const swapped = rotIndex % 2 === 1;
        const aspect = swapped ? frame.height / frame.width : frame.width / frame.height;

        // 2. Redimensionnement 320×320 RGB.
        const rgb = resize(frame, {
          scale: { width: MODEL_INPUT, height: MODEL_INPUT },
          rotation,
          pixelFormat: 'rgb',
          dataType: 'uint8',
        });
        const input = rgb.buffer.slice(rgb.byteOffset, rgb.byteOffset + rgb.byteLength) as ArrayBuffer;

        // 3. Inférence. Sorties : boîtes [25×4], classes [25], scores [25], nombre [1].
        const out = tflite.runSync([input]);
        const boxes = new Float32Array(out[0]);
        const classes = new Float32Array(out[1]);
        const scores = new Float32Array(out[2]);
        const count = Math.min(Math.round(new Float32Array(out[3])[0] ?? 0), scores.length);

        let best = -1;
        let bestScore = 0;
        for (let i = 0; i < count; i++) {
          if (Math.round(classes[i]) === AIRPLANE_CLASS && scores[i] > bestScore) {
            best = i;
            bestScore = scores[i];
          }
        }

        if (best < 0) {
          report({
            found: false, confidence: 0, box: null, sizeRatio: 0,
            sharpness: 0, brightness: 0, moire: 0, screenObject: 0, screenClass: -1,
            aspect, inferenceMs: Date.now() - t0,
          });
          return;
        }

        // Boîte au format [ymin, xmin, ymax, xmax], normalisée 0–1.
        const ymin = Math.max(0, boxes[best * 4]);
        const xmin = Math.max(0, boxes[best * 4 + 1]);
        const ymax = Math.min(1, boxes[best * 4 + 2]);
        const xmax = Math.min(1, boxes[best * 4 + 3]);
        const w = xmax - xmin;
        const h = ymax - ymin;
        const sizeRatio = Math.max(w, h);

        // 4. Netteté (variance du laplacien) et luminosité sur la zone de l'avion.
        const S = MODEL_INPUT;
        const x0 = Math.max(1, Math.floor(xmin * S));
        const x1 = Math.min(S - 2, Math.ceil(xmax * S));
        const y0 = Math.max(1, Math.floor(ymin * S));
        const y1 = Math.min(S - 2, Math.ceil(ymax * S));
        const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 120));
        let sum = 0;
        let sumSq = 0;
        let lum = 0;
        let n = 0;
        for (let y = y0; y <= y1; y += step) {
          for (let x = x0; x <= x1; x += step) {
            // Gris = 0,299 R + 0,587 V + 0,114 B ; laplacien 4-voisins.
            const k = (y * S + x) * 3;
            const kl = k - 3;
            const kr = k + 3;
            const ku = k - S * 3;
            const kd = k + S * 3;
            const c = 0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2];
            const l = 0.299 * rgb[kl] + 0.587 * rgb[kl + 1] + 0.114 * rgb[kl + 2];
            const r = 0.299 * rgb[kr] + 0.587 * rgb[kr + 1] + 0.114 * rgb[kr + 2];
            const u = 0.299 * rgb[ku] + 0.587 * rgb[ku + 1] + 0.114 * rgb[ku + 2];
            const dn = 0.299 * rgb[kd] + 0.587 * rgb[kd + 1] + 0.114 * rgb[kd + 2];
            const lap = l + r + u + dn - 4 * c;
            sum += lap;
            sumSq += lap * lap;
            lum += c;
            n++;
          }
        }
        const mean = n > 0 ? sum / n : 0;
        const sharpness = n > 0 ? sumSq / n - mean * mean : 0;
        const brightness = n > 0 ? lum / n : 0;

        // 5. Photo d'écran ? (web/screen.js, fonctions 'worklet' sans objet natif capturé)
        const scr = findScreenObject(boxes, classes, scores, count, xmin, ymin, xmax, ymax);
        // Centre de l'avion ramené dans l'image brute du capteur (rotation dans le sens horaire,
        // comme le plugin de redimensionnement), puis carré de 128 px à pleine résolution.
        // Fait après les mesures : le plugin peut réutiliser la mémoire de `rgb`.
        const ux = (xmin + xmax) / 2;
        const uy = (ymin + ymax) / 2;
        let ax = ux;
        let ay = uy;
        if (rotIndex === 1) { ax = uy; ay = 1 - ux; }
        else if (rotIndex === 2) { ax = 1 - ux; ay = 1 - uy; }
        else if (rotIndex === 3) { ax = 1 - uy; ay = ux; }
        let moire = 0;
        if (frame.width >= PATCH && frame.height >= PATCH) {
          const px = Math.round(Math.min(frame.width - PATCH, Math.max(0, ax * frame.width - PATCH / 2)));
          const py = Math.round(Math.min(frame.height - PATCH, Math.max(0, ay * frame.height - PATCH / 2)));
          const patch = resize(frame, {
            crop: { x: px, y: py, width: PATCH, height: PATCH },
            scale: { width: PATCH, height: PATCH },
            pixelFormat: 'rgb',
            dataType: 'uint8',
          });
          moire = analyzePatch(patch, PATCH).moire;
        }

        report({
          found: true,
          confidence: bestScore,
          box: { x: xmin, y: ymin, w, h },
          sizeRatio,
          sharpness,
          brightness,
          moire,
          screenObject: scr.score,
          screenClass: scr.cls,
          aspect,
          inferenceMs: Date.now() - t0,
        });
      }
    },
    [boxed, rotationOffset, resize, report, lastRun, intervalMs],
  );

  return {
    frameProcessor,
    detection,
    modelState: model.state,
    modelError: model.state === 'error' ? model.error : null,
  };
}

type ModelState =
  | { state: 'loading' }
  | { state: 'loaded'; model: TensorflowModel }
  | { state: 'error'; error: string };

/**
 * Charge le modèle embarqué. Dans l'app Android compilée, `require()` donne un nom de ressource
 * (« assets_models_efficientdet ») que fast-tflite 3.0.1 ne sait pas ouvrir (il attend une URL).
 * expo-asset copie d'abord le modèle dans un fichier, puis on passe son chemin file://.
 */
function useModel(): ModelState {
  const [state, setState] = useState<ModelState>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const asset = await Asset.fromModule(require('../assets/models/efficientdet.tflite')).downloadAsync();
        const url = asset.localUri ?? asset.uri;
        const model = await loadTensorflowModel({ url }, Platform.OS === 'ios' ? ['core-ml'] : []);
        if (!cancelled) setState({ state: 'loaded', model });
      } catch (e) {
        if (!cancelled) setState({ state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}
