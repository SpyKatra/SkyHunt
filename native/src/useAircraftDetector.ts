// Détection d'avion en direct (vision-camera 5 + react-native-worklets).
//
// Chaîne par image analysée (~5 par seconde) :
//  1. Le Resizer (GPU : Vulkan sur Android, Metal sur iPhone) remet l'image à l'endroit et la
//     réduit en 320×320 RGB pour le modèle.
//  2. EfficientDet-Lite0 (fast-tflite, objet Nitro utilisable directement dans le worklet).
//  3. Netteté / luminosité sur la zone de l'avion (image 320×320).
//  4. Anti-écran : carré de 128 px à PLEINE résolution lu dans les plans YUV de l'image,
//     converti en RGB, puis web/screen.js (une analyse sur deux).
import { Asset } from 'expo-asset';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { CommonResolutions, useFrameOutput, type Frame } from 'react-native-vision-camera';
import { isResizerAvailable, useResizer } from 'react-native-vision-camera-resizer';
import { scheduleOnRN } from 'react-native-worklets';
import { AIRPLANE_CLASS, DETECTION_FPS, MODEL_INPUT } from './config';
import { analyzePatch, findScreenObject, PATCH, pushMedian } from './shared';
import type { Detection } from './types';

const IS_ANDROID = Platform.OS === 'android';

/** État gardé d'une image à l'autre dans le runtime du worklet (les captures de closure sont copiées). */
type WorkletState = { last: number; count: number; frames: number; fpsT0: number; fps: number };

export function useAircraftDetector() {
  const model = useModel();
  const tflite = model.state === 'loaded' ? model.model : undefined;

  const gpuAvailable = useMemo(() => { try { return isResizerAvailable(); } catch { return false; } }, []);
  const resizerState = useResizer({
    width: MODEL_INPUT,
    height: MODEL_INPUT,
    channelOrder: 'rgb',
    dataType: 'uint8',
    scaleMode: 'stretch',
    pixelLayout: 'interleaved',
  });
  // Si le Resizer échoue (shader absent, pilote Vulkan…), on passe au calcul sur le processeur.
  const gpu = gpuAvailable && resizerState.state !== "error";
  const resizer = gpu ? resizerState.resizer : undefined;

  const [detection, setDetection] = useState<Detection | null>(null);
  // Côté JS : médiane du moiré sur les 3 dernières mesures (un pic dû au bruit ne suffit pas).
  const moireHist = useRef<number[]>([]);
  const lastMoire = useRef(0);
  const lastMoireMs = useRef(-1);
  const lastRot = useRef<number[] | undefined>(undefined);
  const lastPeaks = useRef('');
  const report = useMemo(() => (d: Detection) => {
    if (d.rotConf) lastRot.current = d.rotConf;
    else d.rotConf = lastRot.current;
    if (d.moirePeaks !== undefined) lastPeaks.current = d.moirePeaks;
    else d.moirePeaks = lastPeaks.current;
    if (!d.found) { moireHist.current = []; lastMoire.current = 0; }
    else if (d.moire >= 0) lastMoire.current = d.moire = pushMedian(moireHist.current, d.moire);
    else d.moire = lastMoire.current;
    if (d.moireMs != null && d.moireMs >= 0) lastMoireMs.current = d.moireMs;
    else d.moireMs = lastMoireMs.current;
    setDetection(d);
  }, []);

  const intervalMs = 1000 / DETECTION_FPS;
  const ready = tflite != null && (resizer != null || !gpu);

  // Mémorisé : sinon le worklet (et le modèle qu'il capture) serait renvoyé au fil de la caméra
  // à chaque nouveau rendu, 5 fois par seconde.
  const onFrame = useCallback((frame: Frame) => {
      'worklet';
      try {
        if (!ready || tflite == null) return;
        const g = globalThis as unknown as { __sky?: WorkletState };
        const state = g.__sky ?? (g.__sky = { last: 0, count: 0, frames: 0, fpsT0: Date.now(), fps: 0 });
        const t0 = Date.now();
        // Cadence réelle des images reçues (toutes, pas seulement celles analysées).
        state.frames += 1;
        if (t0 - state.fpsT0 >= 1000) {
          state.fps = Math.round((state.frames * 1000) / (t0 - state.fpsT0));
          state.frames = 0;
          state.fpsT0 = t0;
        }
        if (t0 - state.last < intervalMs) return;
        state.last = t0;
        state.count += 1;

        // Orientation : l'image brute du capteur est tournée. rot = quarts de tour (sens horaire) pour la remettre
        // à l'endroit. Mesuré sur Samsung S23 (2026-11-05, diagnostic « confiance selon la rotation ») : téléphone
        // vertical = « left » = 90°. Le Resizer, lui, tourne « left » de 270° (image à l'envers : confiance 26 % au
        // lieu de 57 %) : on retourne son image de 180° quand l'orientation est « left » ou « right ».
        const o = frame.orientation;
        const rot = IS_ANDROID
          ? (o === 'left' ? 1 : o === 'down' ? 2 : o === 'right' ? 3 : 0)
          : (o === 'right' ? 1 : o === 'down' ? 2 : o === 'left' ? 3 : 0); // iPhone : pas encore vérifié
        const flipResized = IS_ANDROID && (rot === 1 || rot === 3);
        const fw = frame.width;
        const fh = frame.height;
        const aspect = rot % 2 === 1 ? fh / fw : fw / fh;
        const frameInfo = `${fw}×${fh} ${o}`;

        // Plans YUV : seulement s'ils servent (repli sans GPU, ou image où l'on mesure le moiré).
        const wantMoire = state.count % 2 === 0;
        let yBuf = new Uint8Array(0);
        let yRow = 0;
        let uBuf: Uint8Array | null = null;
        let vBuf: Uint8Array | null = null;
        let uvRow = 0;
        let uvStride = 1;
        let uvInterleaved = false;
        const planes = resizer == null || wantMoire ? frame.getPlanes() : [];
        if (planes.length > 0) {
          yBuf = new Uint8Array(planes[0].getPixelBuffer());
          yRow = planes[0].bytesPerRow;
        }
        if (planes.length >= 3) {
          uBuf = new Uint8Array(planes[1].getPixelBuffer());
          vBuf = new Uint8Array(planes[2].getPixelBuffer());
          uvRow = planes[1].bytesPerRow;
          uvStride = Math.max(1, Math.round(planes[1].bytesPerRow / planes[1].width));
        } else if (planes.length === 2) {
          // iPhone : plan CbCr entrelacé.
          uBuf = new Uint8Array(planes[1].getPixelBuffer());
          vBuf = uBuf;
          uvRow = planes[1].bytesPerRow;
          uvStride = 2;
          uvInterleaved = true;
        }
        // Pixel (x, y) de l'image BRUTE → R, G, B (BT.601 pleine échelle).
        const rgbAt = (x: number, y: number, out: Uint8Array, k: number) => {
          'worklet';
          const Y = yBuf[y * yRow + x];
          let U = 128;
          let V = 128;
          if (uBuf != null && vBuf != null) {
            const i = (y >> 1) * uvRow + (x >> 1) * uvStride;
            U = uBuf[i];
            V = uvInterleaved ? vBuf[i + 1] : vBuf[i];
          }
          const r = Y + 1.402 * (V - 128);
          const gg = Y - 0.344136 * (U - 128) - 0.714136 * (V - 128);
          const b = Y + 1.772 * (U - 128);
          out[k] = r < 0 ? 0 : r > 255 ? 255 : r;
          out[k + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
          out[k + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        };
        // Coordonnée normalisée À L'ENDROIT → image brute (même convention que le Resizer).
        const toRaw = (ux: number, uy: number) => {
          'worklet';
          if (rot === 1) return [uy, 1 - ux];
          if (rot === 2) return [1 - ux, 1 - uy];
          if (rot === 3) return [1 - uy, ux];
          return [ux, uy];
        };

        // 1. Image 320×320 à l'endroit pour le modèle.
        const S = MODEL_INPUT;
        let rgb: Uint8Array;
        let input: ArrayBuffer;
        if (resizer != null) {
          const resized = resizer.resize(frame);
          // Copie : le tampon GPU n'est plus valable après dispose().
          input = resized.getPixelBuffer().slice(0);
          resized.dispose();
          rgb = new Uint8Array(input);
          if (flipResized) {
            // Rotation de 180° = ordre des pixels inversé.
            const n = S * S;
            for (let i = 0, j = n - 1; i < j; i++, j--) {
              const a = i * 3;
              const b = j * 3;
              const r0 = rgb[a], g0 = rgb[a + 1], b0 = rgb[a + 2];
              rgb[a] = rgb[b]; rgb[a + 1] = rgb[b + 1]; rgb[a + 2] = rgb[b + 2];
              rgb[b] = r0; rgb[b + 1] = g0; rgb[b + 2] = b0;
            }
          }
        } else {
          rgb = new Uint8Array(S * S * 3);
          for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
              const p = toRaw((x + 0.5) / S, (y + 0.5) / S);
              const rx = Math.min(fw - 1, Math.floor(p[0] * fw));
              const ry = Math.min(fh - 1, Math.floor(p[1] * fh));
              rgbAt(rx, ry, rgb, (y * S + x) * 3);
            }
          }
          input = rgb.buffer as ArrayBuffer;
        }

        // 2. Inférence. Sorties : boîtes [25×4], classes [25], scores [25], nombre [1].
        const out = tflite.runSync([input]);
        // Copies : les analyses tournées du diagnostic peuvent réutiliser les tampons de sortie du modèle.
        const boxes = new Float32Array(out[0]).slice();
        const classes = new Float32Array(out[1]).slice();
        const scores = new Float32Array(out[2]).slice();
        const count = Math.min(Math.round(new Float32Array(out[3])[0] ?? 0), scores.length);
        const detectMs = Date.now() - t0;

        // Diagnostic (toutes les 10 analyses, ~2 s) : le modèle voit-il mieux l'avion si l'image est tournée ?
        // Si 90°/180°/270° donne nettement plus que 0°, l'image arrive au modèle de travers.
        let rotConf: number[] | undefined;
        if (state.count % 10 === 0) {
          const airplaneScore = (o: ArrayBuffer[]) => {
            'worklet';
            const cl = new Float32Array(o[1]);
            const sc = new Float32Array(o[2]);
            const nb = Math.min(Math.round(new Float32Array(o[3])[0] ?? 0), sc.length);
            let m = 0;
            for (let i = 0; i < nb; i++) if (Math.round(cl[i]) === AIRPLANE_CLASS && sc[i] > m) m = sc[i];
            return m;
          };
          rotConf = [0]; // 0° = analyse principale (rempli plus bas avec bestScore)
          const src = new Uint8Array(input);
          for (let k = 1; k <= 3; k++) {
            const dst = new Uint8Array(S * S * 3);
            for (let y = 0; y < S; y++) {
              for (let x = 0; x < S; x++) {
                // Pixel (x, y) → position après rotation de k × 90° dans le sens horaire.
                const nx = k === 1 ? S - 1 - y : k === 2 ? S - 1 - x : y;
                const ny = k === 1 ? x : k === 2 ? S - 1 - y : S - 1 - x;
                const si = (y * S + x) * 3;
                const di = (ny * S + nx) * 3;
                dst[di] = src[si];
                dst[di + 1] = src[si + 1];
                dst[di + 2] = src[si + 2];
              }
            }
            rotConf.push(airplaneScore(tflite.runSync([dst.buffer as ArrayBuffer])));
          }
        }

        let best = -1;
        let bestScore = 0;
        for (let i = 0; i < count; i++) {
          if (Math.round(classes[i]) === AIRPLANE_CLASS && scores[i] > bestScore) {
            best = i;
            bestScore = scores[i];
          }
        }
        if (rotConf) rotConf[0] = bestScore;
        if (best < 0) {
          scheduleOnRN(report, {
            found: false, confidence: 0, box: null, sizeRatio: 0,
            sharpness: 0, brightness: 0, moire: 0, screenObject: 0, screenClass: -1,
            aspect, inferenceMs: Date.now() - t0, detectMs, moireMs: -1, frameInfo, cameraFps: state.fps, rotConf,
          });
          return;
        }

        // Boîte [ymin, xmin, ymax, xmax] normalisée 0–1, image à l'endroit.
        const ymin = Math.max(0, boxes[best * 4]);
        const xmin = Math.max(0, boxes[best * 4 + 1]);
        const ymax = Math.min(1, boxes[best * 4 + 2]);
        const xmax = Math.min(1, boxes[best * 4 + 3]);
        const w = xmax - xmin;
        const h = ymax - ymin;

        // 3. Netteté (variance du laplacien) et luminosité sur la zone de l'avion.
        const x0 = Math.max(1, Math.floor(xmin * S));
        const x1 = Math.min(S - 2, Math.ceil(xmax * S));
        const y0 = Math.max(1, Math.floor(ymin * S));
        const y1 = Math.min(S - 2, Math.ceil(ymax * S));
        const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 120));
        let sum = 0;
        let sumSq = 0;
        let lum = 0;
        let n = 0;
        const gray = (k: number) => {
          'worklet';
          return 0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2];
        };
        for (let y = y0; y <= y1; y += step) {
          for (let x = x0; x <= x1; x += step) {
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

        // 4. Photo d'écran ?
        const scr = findScreenObject(boxes, classes, scores, count, xmin, ymin, xmax, ymax);
        let moire = -1;
        let moireMs = -1;
        let moirePeaks: string | undefined;
        if (wantMoire && yBuf.length > 0 && fw >= PATCH && fh >= PATCH) {
          const tm = Date.now();
          const c = toRaw((xmin + xmax) / 2, (ymin + ymax) / 2);
          const px = Math.round(Math.min(fw - PATCH, Math.max(0, c[0] * fw - PATCH / 2)));
          const py = Math.round(Math.min(fh - PATCH, Math.max(0, c[1] * fh - PATCH / 2)));
          const patch = new Uint8Array(PATCH * PATCH * 3);
          for (let y = 0; y < PATCH; y++) {
            for (let x = 0; x < PATCH; x++) rgbAt(px + x, py + y, patch, (y * PATCH + x) * 3);
          }
          const an = analyzePatch(patch, PATCH);
          moire = an.moire;
          moirePeaks = an.peaks;
          moireMs = Date.now() - tm;
        }

        scheduleOnRN(report, {
          found: true,
          confidence: bestScore,
          box: { x: xmin, y: ymin, w, h },
          sizeRatio: Math.max(w, h),
          sharpness,
          brightness,
          moire,
          screenObject: scr.score,
          screenClass: scr.cls,
          aspect,
          inferenceMs: Date.now() - t0,
          detectMs,
          moireMs,
          frameInfo,
          cameraFps: state.fps,
          rotConf,
          moirePeaks,
        });
      } finally {
        frame.dispose();
      }
  }, [ready, tflite, resizer, report, intervalMs]);

  const frameOutput = useFrameOutput({
    // 4:3 comme la photo ; 1440×1920 suffit pour le moiré et reste léger.
    targetResolution: CommonResolutions.FHD_4_3,
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame,
  });

  return {
    frameOutput,
    detection,
    gpu,
    modelState: model.state,
    modelError: model.state === 'error' ? model.error : null,
    gpuError: gpuAvailable && resizerState.state === 'error' ? resizerState.error.message : null,
  };
}

type ModelState =
  | { state: 'loading' }
  | { state: 'loaded'; model: TensorflowModel }
  | { state: 'error'; error: string };

/**
 * Charge le modèle embarqué. Dans l'app Android compilée, `require()` donne un nom de ressource
 * que fast-tflite ne sait pas ouvrir (il attend une URL) : expo-asset copie d'abord le modèle
 * dans un fichier, puis on passe son chemin file://.
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
