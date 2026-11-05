// Compte et sauvegarde des captures sur Supabase — même protocole que web/cloud.js,
// pour qu'un joueur retrouve les mêmes cartes sur le web et dans l'app.
//
// Le téléphone reste la source immédiate (src/storage.ts) : on capture sans réseau,
// puis sync() envoie ce qui est en attente et récupère ce qui vient d'un autre appareil.
// Champs de synchro sur les captures : ownerId, syncState ('pending' | 'synced'), rev, photoPath.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { File } from 'expo-file-system';
import { AppState } from 'react-native';
import { SUPABASE_KEY, SUPABASE_URL } from '../../web/cloud-config.js';
import { compressForUpload } from './ocr';
import { deleteCapture, downloadPhoto, getCapture, listCaptures, putCapture } from './storage';
import type { Capture, RankRow } from './types';

const BUCKET = 'captures';
const DELETES_KEY = 'skyhunt.pendingDeletes';
const PAGE = 500;

export type Profile = { pseudo: string; country: string };
export type CloudState = {
  enabled: boolean;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  profileLoaded: boolean;
  syncing: boolean;
  pending: number;
  lastSync: Date | null;
  error: string | null;
};

let sb: SupabaseClient | null = null;
const listeners = new Set<(s: CloudState) => void>();
let syncPromise: Promise<{ pushed: number; pulled: number }> | null = null;
let syncAgain = false;
let deletes: { uid: string; id: string }[] = [];
const st: CloudState = {
  enabled: false, user: null, profile: null, profileLoaded: false,
  syncing: false, pending: 0, lastSync: null, error: null,
};

export const cloudState = () => st;
export function onCloudChange(fn: (s: CloudState) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function emit() {
  const snap = { ...st };
  for (const fn of listeners) {
    try { fn(snap); } catch (e) { console.error(e); }
  }
}
/** Signalé quand des captures arrivent d'un autre appareil (l'app recharge sa liste). */
const pulledListeners = new Set<() => void>();
export function onPulled(fn: () => void) {
  pulledListeners.add(fn);
  return () => { pulledListeners.delete(fn); };
}

const client = () => {
  if (!sb) throw new Error('Serveur non configuré');
  return sb;
};

/* =================== Démarrage =================== */
export async function initCloud() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return st;
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'skyhunt.auth' },
  });
  st.enabled = true;
  try { deletes = JSON.parse((await AsyncStorage.getItem(DELETES_KEY)) || '[]'); } catch { deletes = []; }

  const { data } = await sb.auth.getSession();
  await setUser(data.session ? data.session.user : null);
  sb.auth.onAuthStateChange((_event, session) => {
    const u = session ? session.user : null;
    if ((u && u.id) !== (st.user && st.user.id)) setUser(u).then(() => scheduleSync(0));
  });
  // Recommandation Supabase pour React Native : rafraîchir le jeton seulement au premier plan.
  AppState.addEventListener('change', (s) => {
    if (!sb) return;
    if (s === 'active') {
      sb.auth.startAutoRefresh();
      scheduleSync(500);
    } else {
      sb.auth.stopAutoRefresh();
    }
  });
  await countPending();
  emit();
  return st;
}

async function setUser(u: User | null) {
  st.user = u ? { id: u.id, email: u.email || '' } : null;
  st.profile = null;
  st.profileLoaded = false;
  st.error = null;
  if (st.user) {
    await claimAnonymous();
    await loadRemoteProfile();
  }
  await countPending();
  emit();
}

/* =================== Connexion par code =================== */
export async function sendCode(email: string) {
  const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw new Error(frenchError(error));
}

export async function verifyCode(email: string, code: string) {
  const { data, error } = await client().auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw new Error(frenchError(error));
  await setUser(data.user);
  scheduleSync(0);
}

/** Déconnexion : on envoie d'abord ce qui reste, puis on retire du téléphone les cartes du compte. */
export async function signOut({ force = false } = {}): Promise<{ ok: boolean; pending?: number }> {
  if (!st.user) return { ok: true };
  try { await sync(); } catch { /* hors ligne */ }
  await countPending();
  if (st.pending > 0 && !force) return { ok: false, pending: st.pending };
  const uid = st.user.id;
  for (const c of await listCaptures()) if (c.ownerId === uid) await deleteCapture(c.id);
  await client().auth.signOut();
  await setUser(null);
  return { ok: true };
}

/* =================== Profil =================== */
async function loadRemoteProfile() {
  const { data, error } = await client().from('profiles').select('pseudo, country').eq('id', st.user!.id).maybeSingle();
  if (error) { st.error = frenchError(error); return; }
  st.profile = (data as Profile) || null;
  st.profileLoaded = true;
}

export async function saveRemoteProfile({ pseudo, country }: Profile) {
  const row = { id: st.user!.id, pseudo: pseudo.trim(), country };
  const { data, error } = await client().from('profiles').upsert(row).select('pseudo, country').single();
  if (error) throw new Error(frenchError(error));
  st.profile = data as Profile;
  st.profileLoaded = true;
  emit();
  return data as Profile;
}

/* =================== Suppression du compte =================== */
export async function deleteAccount() {
  const uid = st.user!.id;
  const storage = client().storage.from(BUCKET);
  for (;;) {
    const { data, error } = await storage.list(uid, { limit: 100 });
    if (error) throw new Error(frenchError(error));
    if (!data.length) break;
    const { error: e2 } = await storage.remove(data.map((f) => `${uid}/${f.name}`));
    if (e2) throw new Error(frenchError(e2));
  }
  const { error } = await client().rpc('delete_my_account');
  if (error) throw new Error(frenchError(error));
  for (const c of await listCaptures()) if (c.ownerId === uid) await deleteCapture(c.id);
  await writeDeletes(deletes.filter((d) => d.uid !== uid));
  await client().auth.signOut({ scope: 'local' });
  await setUser(null);
}

/* =================== Marquage des captures locales =================== */
/** À appeler sur chaque capture avant de l'enregistrer (création ou correction). */
export function stamp(record: Capture): Capture {
  const r: Capture = { ...record, rev: (record.rev || 0) + 1 };
  if (st.user) {
    r.ownerId = r.ownerId || st.user.id;
    r.syncState = 'pending';
  }
  return r;
}

/** Les captures faites sans compte rejoignent le premier compte connecté sur ce téléphone. */
async function claimAnonymous() {
  for (const c of await listCaptures()) {
    if (!c.ownerId) await putCapture({ ...c, ownerId: st.user!.id, syncState: 'pending' });
  }
}

/** Mémorise une suppression à faire sur le serveur (même hors ligne). */
export async function queueDelete(c: Capture) {
  if (!c.ownerId || !st.enabled) return;
  await writeDeletes([...deletes, { uid: c.ownerId, id: c.id }]);
  scheduleSync(0);
}
async function writeDeletes(list: { uid: string; id: string }[]) {
  deletes = list;
  try { await AsyncStorage.setItem(DELETES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

async function countPending() {
  if (!st.user) { st.pending = 0; return; }
  const uid = st.user.id;
  const local = await listCaptures();
  st.pending = local.filter((c) => c.ownerId === uid && c.syncState !== 'synced').length
    + deletes.filter((d) => d.uid === uid).length;
}

/* =================== Synchronisation =================== */
let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(delay = 1500) {
  if (!st.enabled || !st.user) return;
  clearTimeout(timer);
  timer = setTimeout(() => { sync().catch(() => {}); }, delay);
}

export function sync(): Promise<{ pushed: number; pulled: number }> {
  if (!st.enabled || !st.user) return Promise.resolve({ pushed: 0, pulled: 0 });
  if (syncPromise) { syncAgain = true; return syncPromise; }
  syncPromise = (async () => {
    let total = { pushed: 0, pulled: 0 };
    do {
      syncAgain = false;
      st.syncing = true;
      st.error = null;
      emit();
      try {
        const uid = st.user!.id;
        await pushDeletes(uid);
        const pushed = await pushCaptures(uid);
        const pulled = (await pullCaptures(uid)) + (await pullScores(uid));
        total = { pushed: total.pushed + pushed, pulled: total.pulled + pulled };
        st.lastSync = new Date();
      } catch (e) {
        st.error = (e as Error).message || String(e);
        syncAgain = false;
      }
    } while (syncAgain && st.user);
    st.syncing = false;
    await countPending();
    emit();
    if (total.pulled) for (const fn of pulledListeners) fn();
    return total;
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function pushDeletes(uid: string) {
  for (const d of deletes.filter((x) => x.uid === uid)) {
    await client().storage.from(BUCKET).remove([`${uid}/${d.id}.jpg`]);
    const { error } = await client().from('captures').delete().eq('user_id', uid).eq('client_id', d.id);
    if (error) throw new Error(frenchError(error));
    await writeDeletes(deletes.filter((x) => !(x.uid === uid && x.id === d.id)));
  }
}

async function pushCaptures(uid: string) {
  let n = 0;
  const todo = (await listCaptures()).filter((c) => c.ownerId === uid && c.syncState !== 'synced');
  for (const c of todo.reverse()) { // les plus anciennes d'abord
    let photoPath = c.photoPath || null;
    // On n'envoie la photo que des captures valides (les refusées ne gardent que les mesures).
    if (!photoPath && c.valid && c.photoUri) {
      const path = `${uid}/${c.id}.jpg`;
      const small = await compressForUpload(c.photoUri);
      const body = await new File(small).arrayBuffer();
      const { error } = await client().storage.from(BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: false });
      try { new File(small).delete(); } catch { /* fichier temporaire */ }
      if (error && !isAlreadyExists(error)) throw new Error(`Photo : ${frenchError(error)}`);
      photoPath = path;
    }
    const { error } = await client().from('captures').upsert(toRow(c, uid, photoPath), { onConflict: 'user_id,client_id' });
    if (error) throw new Error(frenchError(error));
    // Marquer « envoyée » seulement si la capture n'a pas changé entre-temps.
    const now = await getCapture(c.id);
    if (now) {
      await putCapture(now.rev === c.rev ? { ...now, photoPath, syncState: 'synced' } : { ...now, photoPath });
    }
    n++;
  }
  return n;
}

type Row = Record<string, any>;

async function pullCaptures(uid: string) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client().from('captures').select('*').eq('user_id', uid)
      .order('taken_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(frenchError(error));
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  const local = new Map((await listCaptures()).map((c) => [c.id, c]));
  const deleting = new Set(deletes.filter((d) => d.uid === uid).map((d) => d.id));
  let n = 0;
  for (const row of rows) {
    if (deleting.has(row.client_id)) continue;
    const mine = local.get(row.client_id);
    if (!mine) {
      const rec = fromRow(row, uid);
      if (row.photo_path) rec.photoUri = await fetchPhoto(row.client_id, row.photo_path);
      await putCapture(rec);
      n++;
    } else if (mine.syncState === 'synced') {
      // Identification corrigée sur un autre appareil ?
      const upd: Partial<Capture> = {};
      for (const [k, col] of ID_FIELDS) {
        if ((mine[k] ?? null) !== (row[col] ?? null)) (upd as Row)[k] = row[col];
      }
      if (!mine.photoUri && row.photo_path) upd.photoUri = await fetchPhoto(row.client_id, row.photo_path);
      if (Object.keys(upd).length) { await putCapture({ ...mine, ...upd, photoPath: row.photo_path }); n++; }
    }
  }
  // Supprimées sur un autre appareil.
  const remote = new Set(rows.map((r) => r.client_id));
  for (const c of local.values()) {
    if (c.ownerId === uid && c.syncState === 'synced' && !remote.has(c.id)) { await deleteCapture(c.id); n++; }
  }
  return n;
}

/**
 * Points de lieu calculés par le serveur (rareté du lieu d'après les captures de tous les joueurs).
 * Gardés dans la capture locale (`placePoints`) : recomputeAll s'en sert, sinon 1 point.
 */
async function pullScores(uid: string) {
  const { data, error } = await client().rpc('my_scores');
  // Facultatif : sans cette fonction (serveur pas encore à jour), on garde 1 point de lieu sans bloquer la synchro.
  if (error) { console.warn('my_scores', error.message); return 0; }
  const byId = new Map((data as Row[]).map((r) => [r.client_id as string, r.place_points as number]));
  let n = 0;
  for (const c of await listCaptures()) {
    if (c.ownerId !== uid || !byId.has(c.id) || c.placePoints === byId.get(c.id)) continue;
    const now = await getCapture(c.id); // relue : ne pas écraser une modification faite entre-temps
    if (now) { await putCapture({ ...now, placePoints: byId.get(c.id) }); n++; }
  }
  return n;
}

/** Classement : country null = mondial, sinon code ISO ; month = une date du mois (AAAA-MM-JJ) ou null. */
export async function fetchLeaderboard({ country = null, month = null, limit = 100 }: { country?: string | null; month?: string | null; limit?: number } = {}): Promise<RankRow[]> {
  if (!st.enabled || !st.user) throw new Error('Connecte-toi pour voir les classements.');
  const { data, error } = await client().rpc('leaderboard', { p_country: country, p_month: month, p_limit: limit });
  if (error) throw new Error(frenchError(error));
  return (data as Row[]).map((r) => ({
    rank: Number(r.rank), pseudo: r.pseudo, country: r.country, points: Number(r.points), captures: Number(r.captures), isMe: !!r.is_me,
  }));
}

async function fetchPhoto(id: string, path: string): Promise<string | null> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data) { console.warn('photo', path, error); return null; }
  try {
    return await downloadPhoto(id, data.signedUrl);
  } catch (e) {
    console.warn('photo', path, e);
    return null;
  }
}

const ID_FIELDS: [keyof Capture, string][] = [
  ['typeId', 'type_id'],
  ['registration', 'registration'],
  ['registrationSource', 'registration_source'],
  ['registryModel', 'registry_model'],
];

function toRow(c: Capture, uid: string, photoPath: string | null) {
  return {
    user_id: uid,
    client_id: c.id,
    taken_at: c.takenAt,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy_m: c.accuracy,
    gps_age_s: c.gpsAgeS,
    width: c.width,
    height: c.height,
    confidence: c.confidence,
    size_ratio: c.sizeRatio,
    sharpness: c.sharpness,
    brightness: c.brightness,
    moire: c.moire ?? null,
    screen_object: c.screenObject ?? null,
    box: c.box,
    thresholds: c.thresholds,
    valid: c.valid,
    reasons: c.reasons || [],
    photo_path: photoPath,
    user_agent: c.userAgent,
    type_id: c.typeId ?? null,
    registration: c.registration ?? null,
    registration_source: c.registrationSource ?? null,
    registry_model: c.registryModel ?? null,
  };
}

function fromRow(r: Row, uid: string): Capture {
  return {
    id: r.client_id,
    takenAt: new Date(r.taken_at).toISOString(),
    photoUri: null,
    width: r.width,
    height: r.height,
    latitude: r.latitude,
    longitude: r.longitude,
    accuracy: r.accuracy_m,
    gpsAgeS: r.gps_age_s,
    confidence: r.confidence ?? 0,
    sizeRatio: r.size_ratio ?? 0,
    sharpness: r.sharpness ?? 0,
    brightness: r.brightness ?? 0,
    moire: r.moire ?? null,
    screenObject: r.screen_object ?? null,
    box: r.box,
    thresholds: r.thresholds,
    valid: r.valid,
    reasons: r.reasons || [],
    typeId: r.type_id,
    registration: r.registration,
    registrationSource: r.registration_source,
    registryModel: r.registry_model,
    userAgent: r.user_agent || '',
    ownerId: uid,
    syncState: 'synced',
    photoPath: r.photo_path,
    rev: 0,
  };
}

/* =================== Messages d'erreur =================== */
function isAlreadyExists(e: any) {
  const s = `${e.statusCode || e.status || ''} ${e.error || ''} ${e.message || ''}`;
  return /409|Duplicate|already exists/i.test(s);
}

function frenchError(e: any): string {
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (e && e.code === '23505') return 'Ce pseudo est déjà pris.';
  if (/expired or is invalid|invalid.*otp|otp.*invalid/i.test(m)) return 'Code invalide ou expiré.';
  if (/rate limit|only request this after|too many/i.test(m)) return 'Trop de demandes : attends un peu avant de réessayer.';
  if (/Failed to fetch|NetworkError|Load failed|Network request failed|network/i.test(m)) return 'Pas de connexion au serveur.';
  if (/invalid.*email|email.*invalid|validate email/i.test(m)) return 'Adresse courriel invalide.';
  if (/signups not allowed/i.test(m)) return 'Les inscriptions sont fermées pour le moment.';
  return m;
}
