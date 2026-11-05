// Lecture minimale des métadonnées EXIF d'une photo JPEG (diagnostic anti-écran, 2026-11-05).
// But : savoir si le téléphone enregistre la distance du sujet (mise au point). Un écran est à moins
// d'un mètre, un avion à des dizaines de mètres : ce serait un indice anti-triche bien plus sûr que le moiré.
import { File } from 'expo-file-system';

export type ExifInfo = {
  /** Distance du sujet en mètres (tag 0x9206), si le téléphone l'écrit. */
  subjectDistance: number | null;
  /** 0 inconnu, 1 macro, 2 proche, 3 lointain (tag 0xA40C). */
  distanceRange: number | null;
  focalLength: number | null;
  focal35: number | null;
  digitalZoom: number | null;
  /** Résumé lisible pour le diagnostic. */
  summary: string;
};

const NAMES: Record<number, string> = {
  0x9206: 'distance', 0xa40c: 'plage', 0x920a: 'focale', 0xa405: 'focale35', 0xa404: 'zoomNum',
  0x829a: 'expo', 0x8827: 'iso', 0x927c: 'makernote',
};

export async function readExif(uri: string): Promise<ExifInfo> {
  const out: ExifInfo = { subjectDistance: null, distanceRange: null, focalLength: null, focal35: null, digitalZoom: null, summary: '' };
  try {
    const buf = new Uint8Array(await new File(uri).arrayBuffer());
    // Segment APP1 « Exif\0\0 »
    let p = 2;
    let tiff = -1;
    while (p + 4 < buf.length && buf[p] === 0xff) {
      const marker = buf[p + 1];
      const len = (buf[p + 2] << 8) | buf[p + 3];
      if (marker === 0xe1 && buf[p + 4] === 0x45 && buf[p + 5] === 0x78 && buf[p + 6] === 0x69 && buf[p + 7] === 0x66) {
        tiff = p + 10;
        break;
      }
      if (marker === 0xda) break; // début de l'image
      p += 2 + len;
    }
    if (tiff < 0) { out.summary = 'EXIF : absent'; return out; }
    const le = buf[tiff] === 0x49; // « II » = petit-boutiste
    const u16 = (o: number) => (le ? buf[o] | (buf[o + 1] << 8) : (buf[o] << 8) | buf[o + 1]);
    const u32 = (o: number) => (le
      ? (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
      : ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0);
    const i32 = (o: number) => u32(o) | 0;
    const tags = (ifd: number) => {
      const n = u16(tiff + ifd);
      const list: { tag: number; type: number; count: number; val: number }[] = [];
      for (let i = 0; i < n; i++) {
        const e = tiff + ifd + 2 + i * 12;
        list.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), val: e + 8 });
      }
      return list;
    };
    const value = (t: { type: number; val: number }) => {
      if (t.type === 3) return u16(t.val); // SHORT
      if (t.type === 4) return u32(t.val); // LONG
      if (t.type === 5 || t.type === 10) { // (S)RATIONAL : pointeur vers 2 entiers
        const o = tiff + u32(t.val);
        const num = t.type === 5 ? u32(o) : i32(o);
        const den = t.type === 5 ? u32(o + 4) : i32(o + 4);
        return den ? num / den : null;
      }
      return null;
    };
    const ifd0 = tags(u32(tiff + 4));
    const exifPtr = ifd0.find((t) => t.tag === 0x8769);
    const exif = exifPtr ? tags(u32(exifPtr.val)) : [];
    const parts: string[] = [];
    for (const t of exif) {
      const v = value(t);
      if (t.tag === 0x9206) out.subjectDistance = v;
      if (t.tag === 0xa40c) out.distanceRange = v;
      if (t.tag === 0x920a) out.focalLength = v;
      if (t.tag === 0xa405) out.focal35 = v;
      if (t.tag === 0xa404) out.digitalZoom = v;
      if (NAMES[t.tag]) parts.push(`${NAMES[t.tag]}=${v == null ? '?' : Math.round(v * 1000) / 1000}`);
    }
    out.summary = `EXIF : ${parts.join(' ') || 'rien d’utile'} · ${exif.length} champs`;
  } catch (e) {
    out.summary = `EXIF : erreur ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`;
  }
  return out;
}
