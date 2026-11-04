// Anti-triche : reconnaître la photo d'un avion affiché sur un écran (ordinateur, téléphone, télé).
// Partagé avec l'app native (native/src/useAircraftDetector.ts) : pas de DOM ici.
// Les fonctions portent la directive 'worklet' (sans effet dans un navigateur) pour pouvoir tourner
// dans le frame processor de vision-camera.
//
// Deux indices, mesurés à chaque analyse :
//  1. screenObject : le détecteur COCO voit une télé, un portable ou un téléphone autour de l'avion.
//  2. moire : pics isolés dans le spectre (FFT) de la couleur d'un carré de 128 px pris à pleine
//     résolution au centre de l'avion. Les sous-pixels d'un écran (et le moiré coloré qu'ils créent
//     avec le capteur) se répètent dans deux directions ; le ciel et la carlingue non.
//     Valeur en dB au-dessus du fond.

/** Classes COCO (indices 0–89 du modèle EfficientDet-Lite0) qui sont des écrans. */
export const SCREEN_CLASSES = { 71: 'écran', 72: 'ordinateur portable', 76: 'téléphone' };

/** Côté du carré analysé à pleine résolution (puissance de 2). */
export const PATCH = 128;

/**
 * Meilleur écran détecté qui contient le centre de l'avion.
 * boxes [ymin, xmin, ymax, xmax] normalisées, comme la sortie du modèle.
 */
export function findScreenObject(boxes, classes, scores, count, xmin, ymin, xmax, ymax) {
  'worklet';
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  let best = 0;
  let cls = -1;
  for (let i = 0; i < count; i++) {
    const c = Math.round(classes[i]);
    if (c !== 71 && c !== 72 && c !== 76) continue;
    if (scores[i] <= best) continue;
    const y0 = boxes[i * 4];
    const x0 = boxes[i * 4 + 1];
    const y1 = boxes[i * 4 + 2];
    const x1 = boxes[i * 4 + 3];
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
      best = scores[i];
      cls = c;
    }
  }
  return { score: best, cls };
}

/** FFT complexe en place (radix 2), n puissance de 2, sur re/im[off + k·stride]. */
function fft(re, im, off, stride, n) {
  'worklet';
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride;
      const b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = off + (i + k) * stride;
        const b = off + (i + k + len / 2) * stride;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * Spectres (log10 de la puissance, indexés [v][u]) de deux canaux réels n×n, fenêtrés (Hann),
 * calculés avec UNE seule FFT complexe (a + i·b) : deux fois moins de calcul.
 * X_a(k) = (Z(k) + conj Z(−k)) / 2 ; X_b(k) = (Z(k) − conj Z(−k)) / 2i.
 */
function logSpectra(a, b, n) {
  'worklet';
  const N = n * n;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < N; i++) { ma += a[i]; mb += b[i]; }
  ma /= N;
  mb /= N;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let y = 0; y < n; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (n - 1));
    for (let x = 0; x < n; x++) {
      const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (n - 1))) * wy;
      const i = y * n + x;
      re[i] = (a[i] - ma) * w;
      im[i] = (b[i] - mb) * w;
    }
  }
  for (let y = 0; y < n; y++) fft(re, im, y * n, 1, n);
  for (let x = 0; x < n; x++) fft(re, im, x, n, n);
  const La = new Float64Array(N);
  const Lb = new Float64Array(N);
  for (let v = 0; v < n; v++) {
    const v2 = (n - v) % n;
    for (let u = 0; u < n; u++) {
      const i = v * n + u;
      const j = v2 * n + ((n - u) % n);
      const ar = re[i] + re[j];
      const ai = im[i] - im[j];
      const br = im[i] + im[j];
      const bi = re[j] - re[i];
      La[i] = Math.log10(0.25 * (ar * ar + ai * ai) + 1e-6);
      Lb[i] = Math.log10(0.25 * (br * br + bi * bi) + 1e-6);
    }
  }
  return [La, Lb];
}

/** Plus fort pic isolé d'un spectre n×n (log10 de puissance, indexé [v][u]). */
function spectralPeak(L, n) {
  'worklet';
  const at =(u, v) => L[(((v % n) + n) % n) * n + (((u % n) + n) % n)];

  // Moyenne (en log) de chaque anneau de fréquence : le « fond » naturel en 1/f.
  const half = n >> 1;
  const ringSum = new Float64Array(half + 1);
  const ringCnt = new Float64Array(half + 1);
  for (let v = 0; v <= half; v++) {
    for (let u = -half + 1; u < half; u++) {
      const r = Math.round(Math.sqrt(u * u + v * v));
      if (r > half) continue;
      ringSum[r] += at(u, v);
      ringCnt[r] += 1;
    }
  }
  // Un pic doit être un maximum local, dépasser le fond de son anneau ET ses voisins dans l'axe
  // radial (sinon c'est une arête droite — aile, horizon — qui fait une crête, pas un pic).
  const rMin = 6;
  const pu = [];
  const pv = [];
  const ps = [];
  for (let v = 0; v <= half - 2; v++) {
    for (let u = -half + 2; u <= half - 2; u++) {
      if (v === 0 && u < 0) continue; // moitié du plan : le spectre est symétrique
      const r2 = u * u + v * v;
      if (r2 < rMin * rMin) continue;
      const rr = Math.sqrt(r2);
      const r = Math.round(rr);
      if (r > half - 2) continue;
      const p = at(u, v);
      const ring = ringSum[r] / ringCnt[r];
      if (p - ring < 0.4) continue;
      if (p < at(u + 1, v) || p < at(u - 1, v) || p < at(u, v + 1) || p < at(u, v - 1)) continue;
      // Crête : on regarde 3 et 4 cases plus loin / plus près dans l'axe du centre, hors du lobe
      // de la fenêtre de Hann (±2 cases), sur les 4 cases autour du point exact pour ne pas rater
      // une crête oblique.
      let ridge = -1e9;
      for (let t = -4; t <= 4; t++) {
        if (t > -3 && t < 3) continue;
        const fu = u + (t * u) / rr;
        const fv = v + (t * v) / rr;
        const u0 = Math.floor(fu);
        const v0 = Math.floor(fv);
        ridge = Math.max(ridge, at(u0, v0), at(u0 + 1, v0), at(u0, v0 + 1), at(u0 + 1, v0 + 1));
      }
      const score = Math.min(p - ring, p - ridge);
      if (score < 0.4) continue;
      pu.push(u); pv.push(v); ps.push(score);
    }
  }
  // Une rangée de hublots est périodique dans UNE direction (pics alignés sur une droite qui passe
  // par le centre). La grille de pixels d'un écran l'est dans DEUX directions : on garde la paire de
  // pics la plus forte dont les directions font au moins 30° entre elles.
  let best = 0;
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] <= best) continue;
    const ri = Math.sqrt(pu[i] * pu[i] + pv[i] * pv[i]);
    for (let j = 0; j < ps.length; j++) {
      if (j === i || ps[j] <= best) continue;
      const rj = Math.sqrt(pu[j] * pu[j] + pv[j] * pv[j]);
      const cos = Math.abs(pu[i] * pu[j] + pv[i] * pv[j]) / (ri * rj);
      if (cos > 0.866) continue;
      best = Math.min(ps[i], ps[j]);
    }
  }
  return best;
}

/**
 * Analyse un carré RGB n×n (Uint8Array, n = PATCH) pris à pleine résolution.
 * Renvoie { moire } : pics du spectre de la COULEUR, en dB au-dessus du fond.
 * La luminance n'est pas utilisée : une rangée de hublots nets y crée aussi des pics, alors que
 * la couleur d'une carlingue ne se répète pas ; celle d'un écran oui (sous-pixels rouge-vert-bleu,
 * moiré coloré avec le filtre de Bayer du capteur).
 */
export function analyzePatch(rgb, n) {
  'worklet';
  const N = n * n;
  const Cb = new Float64Array(N);
  const Cr = new Float64Array(N);
  for (let i = 0, k = 0; i < N; i++, k += 3) {
    const y = 0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2];
    Cb[i] = rgb[k + 2] - y;
    Cr[i] = rgb[k] - y;
  }
  const [Lb, Lr] = logSpectra(Cb, Cr, n);
  return { moire: 10 * Math.max(spectralPeak(Lb, n), spectralPeak(Lr, n)) };
}

/**
 * Médiane (basse) des k dernières valeurs : le moiré d'un vrai écran reste d'une image à l'autre,
 * un pic dû au bruit non. `hist` est un tableau gardé par l'appelant (vidé quand l'avion disparaît).
 */
export function pushMedian(hist, value, k = 3) {
  hist.push(value);
  while (hist.length > k) hist.shift();
  const s = hist.slice().sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
}
