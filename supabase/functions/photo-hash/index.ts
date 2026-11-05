// Empreinte d'une photo envoyée (anti-doublons, supabase/migrations/20261106120000_anti_triche.sql).
//
// Appelée par la base de données (déclencheur captures_hash_request, via pg_net) quand une capture reçoit
// sa photo : { "path": "<id du joueur>/<id local>.jpg" }. La fonction lit la photo dans le stockage privé
// avec la clé de service, calcule son empreinte (thumbprint) et l'enregistre (record_photo_hash), qui note si
// elle copie une photo déjà envoyée.
//
// Pas de vérification de jeton d'utilisateur (verify_jwt = false dans config.toml) : la fonction ne fait que
// recalculer l'empreinte d'une photo qui existe déjà ; l'appeler soi-même ne change rien (première empreinte gardée).
import { createClient } from 'npm:@supabase/supabase-js@2';
import jpeg from 'npm:jpeg-js@0.4.4';

const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,64}\.jpg$/;

const GW = 16, GH = 12;

/**
 * Empreinte : miniature GW × GH en gris (moyenne par zone), moins la moyenne de chaque ligne et de chaque
 * colonne (le dégradé du ciel et l'exposition disparaissent, il reste la silhouette), ramenée à une norme de 1.
 * Deux photos se comparent par produit scalaire (corrélation) : ≈ 1 pour la même photo recompressée ou
 * redimensionnée, faible pour une autre photo.
 */
export function thumbprint(data: Uint8Array, width: number, height: number, channels: number): number[] {
  const sums = new Float64Array(GW * GH);
  const counts = new Float64Array(GW * GH);
  // Un pixel sur deux dans chaque sens suffit largement (4 fois moins de calcul).
  for (let y = 0; y < height; y += 2) {
    const cy = Math.min(GH - 1, Math.floor((y * GH) / height));
    let i = y * width * channels;
    for (let x = 0; x < width; x += 2, i += 2 * channels) {
      const cx = Math.min(GW - 1, Math.floor((x * GW) / width));
      sums[cy * GW + cx] += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      counts[cy * GW + cx] += 1;
    }
  }
  const g = Array.from(sums, (v, k) => v / counts[k]);
  const rowMean = Array.from({ length: GH }, (_, y) => g.slice(y * GW, y * GW + GW).reduce((a, b) => a + b, 0) / GW);
  const colMean = Array.from({ length: GW }, (_, x) => { let t = 0; for (let y = 0; y < GH; y++) t += g[y * GW + x]; return t / GH; });
  const all = g.reduce((a, b) => a + b, 0) / g.length;
  const r = g.map((v, k) => v - rowMean[Math.floor(k / GW)] - colMean[k % GW] + all);
  const norm = Math.sqrt(r.reduce((a, b) => a + b * b, 0)) || 1;
  return r.map((v) => Math.round((v / norm) * 1e5) / 1e5);
}

Deno.serve(async (req) => {
  let path = '';
  try { path = (await req.json()).path; } catch { /* corps invalide */ }
  if (typeof path !== 'string' || !PATH.test(path)) return new Response('chemin invalide', { status: 400 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: file, error } = await sb.storage.from('captures').download(path);
  if (error || !file) return new Response(`photo introuvable : ${error?.message ?? ''}`, { status: 404 });

  let img;
  try {
    img = jpeg.decode(new Uint8Array(await file.arrayBuffer()), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 200 });
  } catch (e) {
    return new Response(`photo illisible : ${(e as Error).message}`, { status: 422 });
  }
  const thumb = thumbprint(img.data, img.width, img.height, 4);
  const { data, error: e2 } = await sb.rpc('record_photo_hash', { p_path: path, p_thumb: thumb });
  if (e2) return new Response(`enregistrement : ${e2.message}`, { status: 500 });
  return Response.json({ path, ...data });
});
