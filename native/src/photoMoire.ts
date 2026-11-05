// Moiré mesuré sur la VRAIE photo, en pleine résolution (diagnostic, 2026-11-05).
// Sur Samsung S23, le flux vidéo en direct (1440×1080, pixels regroupés) est trop lissé : la trame d'un
// écran n'y apparaît pas, alors qu'elle se voit nettement sur la photo. On découpe donc un carré de
// 128 px au centre de l'avion dans la photo et on lui applique la même analyse (web/screen.js).
import { Images } from 'react-native-nitro-image';
import { analyzePatch, PATCH } from './shared';
import type { Box } from './types';

export type PhotoMoire = { moire: number; peaks: string; info: string };

/**
 * @param filePath chemin de la photo (avec ou sans « file:// »)
 * @param box      zone de l'avion dans l'image à l'endroit (0–1), ou null (centre de la photo)
 * @param rot      quarts de tour (sens horaire) qui remettent l'image du capteur à l'endroit
 * @param aspect   largeur / hauteur de l'image à l'endroit
 */
export async function measurePhotoMoire(filePath: string, box: Box | null, rot: number, aspect: number): Promise<PhotoMoire | null> {
  try {
    const img = await Images.loadFromFileAsync(filePath.replace(/^file:\/\//, ''));
    const W = img.width;
    const H = img.height;
    if (W < PATCH || H < PATCH) return null;
    const cx = box ? box.x + box.w / 2 : 0.5;
    const cy = box ? box.y + box.h / 2 : 0.5;
    // Si le fichier n'est pas dans le même sens que l'image à l'endroit (portrait / paysage),
    // ses pixels sont ceux du capteur : on applique la même correspondance que pour la vidéo.
    let rx = cx;
    let ry = cy;
    if ((W >= H) !== (aspect >= 1)) {
      if (rot === 1) { rx = cy; ry = 1 - cx; }
      else if (rot === 3) { rx = 1 - cy; ry = cx; }
    } else if (rot === 2) { rx = 1 - cx; ry = 1 - cy; }
    const px = Math.round(Math.min(W - PATCH, Math.max(0, rx * W - PATCH / 2)));
    const py = Math.round(Math.min(H - PATCH, Math.max(0, ry * H - PATCH / 2)));
    const crop = await img.cropAsync(px, py, px + PATCH, py + PATCH);
    const raw = await crop.toRawPixelDataAsync();
    const src = new Uint8Array(raw.buffer);
    const fmt = raw.pixelFormat;
    const bpp = fmt === 'RGB' || fmt === 'BGR' ? 3 : 4;
    // Position de R, G, B dans chaque pixel selon le format.
    const order: Record<string, [number, number, number]> = {
      RGBA: [0, 1, 2], RGBX: [0, 1, 2], RGB: [0, 1, 2],
      BGRA: [2, 1, 0], BGRX: [2, 1, 0], BGR: [2, 1, 0],
      ARGB: [1, 2, 3], XRGB: [1, 2, 3],
      ABGR: [3, 2, 1], XBGR: [3, 2, 1],
    };
    const [ir, ig, ib] = order[fmt] ?? [0, 1, 2];
    const rowBytes = Math.round(src.length / raw.height); // peut contenir du remplissage
    const rgb = new Uint8Array(PATCH * PATCH * 3);
    for (let y = 0; y < PATCH; y++) {
      for (let x = 0; x < PATCH; x++) {
        const s = y * rowBytes + x * bpp;
        const d = (y * PATCH + x) * 3;
        rgb[d] = src[s + ir];
        rgb[d + 1] = src[s + ig];
        rgb[d + 2] = src[s + ib];
      }
    }
    const an = analyzePatch(rgb, PATCH);
    return { moire: an.moire, peaks: an.peaks, info: `${W}×${H} ${fmt} @${px},${py}` };
  } catch (e) {
    return { moire: -1, peaks: '', info: `erreur : ${e instanceof Error ? e.message : String(e)}`.slice(0, 120) };
  }
}
