// Compte et sauvegarde des captures sur Supabase.
//
// Le téléphone reste la source de vérité immédiate (IndexedDB) : on capture même sans réseau,
// puis sync() envoie ce qui est en attente et récupère ce qui vient d'un autre appareil.
//
// Champs ajoutés aux captures locales :
//   ownerId   : id du compte auquel la capture appartient (absent = jouée sans compte)
//   syncState : 'pending' (à envoyer) ou 'synced'
//   rev       : compteur de modifications locales (évite d'écraser une modif faite pendant l'envoi)
//   photoPath : chemin de la photo dans le compartiment « captures »
import { SUPABASE_KEY, SUPABASE_URL } from './cloud-config.js';
import { addCapture, deleteCapture, getCapture, listCaptures } from './store.js';

const BUCKET = 'captures';
const DELETES_KEY = 'skyhunt.pendingDeletes';
const TOKENS_KEY = 'skyhunt.captureTokens';
const PAGE = 500;

let sb = null;
let listeners = [];
let syncPromise = null;
let syncAgain = false;
const st = {
  enabled: false,
  user: null,       // { id, email }
  profile: null,    // { pseudo, country } ou null si à créer
  profileLoaded: false,
  syncing: false,
  pending: 0,
  lastSync: null,
  error: null,
};

/* =================== Configuration =================== */
function config() {
  // Surcharge pour les tests (instance locale) : localStorage « skyhunt.cloud » = {"url":…,"key":…}
  try {
    const o = JSON.parse(localStorage.getItem('skyhunt.cloud') || 'null');
    if (o && o.url && o.key) return o;
  } catch { /* mode privé */ }
  return { url: SUPABASE_URL, key: SUPABASE_KEY };
}

export const cloudState = () => st;
export const onCloudChange = (fn) => { listeners.push(fn); };
function emit() { for (const fn of listeners) { try { fn(st); } catch (e) { console.error(e); } } }

export async function initCloud() {
  const { url, key } = config();
  if (!url || !key || !window.supabase) return st;
  sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'skyhunt.auth' },
  });
  st.enabled = true;
  const { data } = await sb.auth.getSession();
  await setUser(data.session ? data.session.user : null);
  sb.auth.onAuthStateChange((_event, session) => {
    const u = session ? session.user : null;
    if ((u && u.id) !== (st.user && st.user.id)) setUser(u).then(() => scheduleSync(0));
  });
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(500); });
  await countPending();
  emit();
  return st;
}

async function setUser(u) {
  st.user = u ? { id: u.id, email: u.email } : null;
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
export async function sendCode(email) {
  // Le courriel contient un code (modèle supabase/templates/code.html, demande un SMTP perso)
  // et/ou un lien : le lien ramène ici et la session est lue dans l'adresse (detectSessionInUrl).
  const back = `${location.origin}${location.pathname}`;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: back } });
  if (error) throw new Error(frenchError(error));
}

export async function verifyCode(email, code) {
  const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw new Error(frenchError(error));
  await setUser(data.user);
  scheduleSync(0);
}

/** Déconnexion : on envoie d'abord ce qui reste, puis on retire du téléphone les cartes du compte. */
export async function signOut({ force = false } = {}) {
  if (!st.user) return { ok: true };
  try { await sync(); } catch { /* hors ligne */ }
  await countPending();
  if (st.pending > 0 && !force) return { ok: false, pending: st.pending };
  const uid = st.user.id;
  for (const c of await listCaptures()) if (c.ownerId === uid) await deleteCapture(c.id);
  await sb.auth.signOut();
  await setUser(null);
  return { ok: true };
}

/* =================== Profil =================== */
async function loadRemoteProfile() {
  const { data, error } = await sb.from('profiles').select('pseudo, country').eq('id', st.user.id).maybeSingle();
  if (error) { st.error = frenchError(error); return; }
  st.profile = data || null;
  st.profileLoaded = true;
}

/** Création du profil (une seule fois : pseudo et pays ne sont plus modifiables ensuite, sauf par un administrateur). */
export async function saveRemoteProfile({ pseudo, country }) {
  const row = { id: st.user.id, pseudo: pseudo.trim(), country };
  const { data, error } = await sb.from('profiles').insert(row).select('pseudo, country').single();
  if (error) throw new Error(frenchError(error));
  st.profile = data;
  st.profileLoaded = true;
  emit();
  return data;
}

/* =================== Suppression du compte =================== */
export async function deleteAccount() {
  const uid = st.user.id;
  // 1) photos (Storage ne se vide pas en cascade)
  for (;;) {
    const { data, error } = await sb.storage.from(BUCKET).list(uid, { limit: 100 });
    if (error) throw new Error(frenchError(error));
    if (!data.length) break;
    const { error: e2 } = await sb.storage.from(BUCKET).remove(data.map((f) => `${uid}/${f.name}`));
    if (e2) throw new Error(frenchError(e2));
  }
  // 2) compte, profil et captures (cascade)
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw new Error(frenchError(error));
  for (const c of await listCaptures()) if (c.ownerId === uid) await deleteCapture(c.id);
  writeDeletes(readDeletes().filter((d) => d.uid !== uid));
  await sb.auth.signOut({ scope: 'local' });
  await setUser(null);
}

/* =================== Marquage des captures locales =================== */
/** À appeler sur chaque capture avant de l'enregistrer (création ou correction). */
export function stamp(record) {
  const r = { ...record, rev: (record.rev || 0) + 1 };
  if (st.user) {
    r.ownerId = r.ownerId || st.user.id;
    r.syncState = 'pending';
  }
  return r;
}

/** Les captures faites sans compte rejoignent le premier compte connecté sur ce téléphone. */
async function claimAnonymous() {
  for (const c of await listCaptures()) {
    if (!c.ownerId) await addCapture({ ...c, ownerId: st.user.id, syncState: 'pending' });
  }
}

/** Mémorise une suppression à faire sur le serveur (même hors ligne). */
export function queueDelete(c) {
  // Même une capture « en attente » a pu être envoyée à moitié (photo sans fiche) : on efface toujours.
  if (!c.ownerId || !st.enabled) return;
  writeDeletes([...readDeletes(), { uid: c.ownerId, id: c.id }]);
  scheduleSync(0);
}
/* =================== Jetons de capture (anti-triche) =================== */
// Le serveur distribue des jetons à usage unique (20 au plus en réserve, valables 7 jours). Chaque photo prise
// avec un compte en emporte un : le serveur sait alors qu'elle n'est pas antidatée, même envoyée plus tard
// (hors ligne). Sans jeton, elle compte à son heure de réception. Voir 20261106120000_anti_triche.sql.
const TOKEN_LIFE_MS = 7 * 86400e3 - 3600e3; // marge d'une heure
function readTokens(uid) {
  try { return (JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}')[uid] || []).filter((t) => Date.now() - Date.parse(t.issuedAt) < TOKEN_LIFE_MS); } catch { return []; }
}
function writeTokens(uid, list) {
  try {
    const all = JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}');
    all[uid] = list;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch { /* mode privé */ }
}
async function refillTokens(uid) {
  const have = readTokens(uid);
  if (have.length >= 10) return;
  const { data, error } = await sb.rpc('issue_capture_tokens', { p_count: 20 - have.length });
  if (error) { console.warn('jetons', error.message); return; } // serveur pas à jour : on continue sans
  writeTokens(uid, [...readTokens(uid), ...data.map((t) => ({ token: t.token, issuedAt: t.issued_at }))]);
}
/** Prend un jeton pour une photo qu'on vient de prendre (null sans compte ou réserve vide). */
export function takeCaptureToken() {
  if (!st.user) return null;
  const list = readTokens(st.user.id);
  const t = list.shift();
  writeTokens(st.user.id, list);
  if (list.length < 10) scheduleSync(3000); // la synchro rechargera la réserve
  return t ? t.token : null;
}

function readDeletes() {
  try { return JSON.parse(localStorage.getItem(DELETES_KEY) || '[]'); } catch { return []; }
}
function writeDeletes(list) {
  try { localStorage.setItem(DELETES_KEY, JSON.stringify(list)); } catch { /* mode privé */ }
}

async function countPending() {
  if (!st.user) { st.pending = 0; return; }
  const uid = st.user.id;
  const local = await listCaptures();
  st.pending = local.filter((c) => c.ownerId === uid && c.syncState !== 'synced').length
    + readDeletes().filter((d) => d.uid === uid).length;
}

/* =================== Synchronisation =================== */
let timer = null;
export function scheduleSync(delay = 1500) {
  if (!st.enabled || !st.user) return;
  clearTimeout(timer);
  timer = setTimeout(() => { sync().catch(() => {}); }, delay);
}

/** Envoie les suppressions et captures en attente, puis récupère celles des autres appareils. */
export function sync() {
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
        const uid = st.user.id;
        await refillTokens(uid);
        await pushDeletes(uid);
        const pushed = await pushCaptures(uid);
        const pulled = (await pullCaptures(uid)) + (await pullScores(uid));
        total = { pushed: total.pushed + pushed, pulled: total.pulled + pulled };
        st.lastSync = new Date();
      } catch (e) {
        st.error = e.message || String(e);
        syncAgain = false;
      }
    } while (syncAgain && st.user);
    st.syncing = false;
    await countPending();
    emit();
    if (total.pulled) window.dispatchEvent(new CustomEvent('skyhunt:pulled', { detail: total }));
    return total;
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function pushDeletes(uid) {
  for (const d of readDeletes().filter((x) => x.uid === uid)) {
    // La photo peut exister même si la fiche n'a pas été envoyée : on tente toujours.
    await sb.storage.from(BUCKET).remove([`${uid}/${d.id}.jpg`]);
    const { error } = await sb.from('captures').delete().eq('user_id', uid).eq('client_id', d.id);
    if (error) throw new Error(frenchError(error));
    writeDeletes(readDeletes().filter((x) => !(x.uid === uid && x.id === d.id)));
  }
}

async function pushCaptures(uid) {
  let n = 0;
  const todo = (await listCaptures()).filter((c) => c.ownerId === uid && c.syncState !== 'synced');
  for (const c of todo.reverse()) { // les plus anciennes d'abord
    let photoPath = c.photoPath || null;
    // On n'envoie la photo que des captures valides (les refusées ne gardent que les mesures).
    if (!photoPath && c.valid && c.photo) {
      const path = `${uid}/${c.id}.jpg`;
      const body = await compressForUpload(c.photo);
      const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: false });
      if (error && !isAlreadyExists(error)) throw new Error(`Photo : ${frenchError(error)}`);
      photoPath = path;
    }
    const { error } = await sb.from('captures').upsert(toRow(c, uid, photoPath), { onConflict: 'user_id,client_id' });
    if (error) throw new Error(frenchError(error));
    // Marquer « envoyée » seulement si la capture n'a pas changé entre-temps.
    const now = await getCapture(c.id);
    if (now) {
      await addCapture(now.rev === c.rev
        ? { ...now, photoPath, syncState: 'synced' }
        : { ...now, photoPath });
    }
    n++;
  }
  return n;
}

async function pullCaptures(uid) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('captures').select('*').eq('user_id', uid)
      .order('taken_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(frenchError(error));
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  const local = new Map((await listCaptures()).map((c) => [c.id, c]));
  const deleting = new Set(readDeletes().filter((d) => d.uid === uid).map((d) => d.id));
  let n = 0;
  for (const row of rows) {
    if (deleting.has(row.client_id)) continue;
    const mine = local.get(row.client_id);
    if (!mine) {
      const rec = fromRow(row, uid);
      if (row.photo_path) rec.photo = await downloadPhoto(row.photo_path);
      await addCapture(rec);
      n++;
    } else if (mine.syncState === 'synced') {
      // Identification corrigée sur un autre appareil ?
      const upd = {};
      for (const [k, col, conv = (v) => v] of ID_FIELDS) {
        const v = conv(row[col] ?? null);
        if ((mine[k] ?? null) !== v) upd[k] = v;
      }
      if (!mine.photo && row.photo_path) upd.photo = await downloadPhoto(row.photo_path);
      if (Object.keys(upd).length) { await addCapture({ ...mine, ...upd, photoPath: row.photo_path }); n++; }
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
async function pullScores(uid) {
  const { data, error } = await sb.rpc('my_scores');
  // Facultatif : sans cette fonction (serveur pas encore à jour), on garde 1 point de lieu sans bloquer la synchro.
  if (error) { console.warn('my_scores', error.message); return 0; }
  const byId = new Map(data.map((r) => [r.client_id, r]));
  let n = 0;
  for (const c of await listCaptures()) {
    if (c.ownerId !== uid || !byId.has(c.id)) continue;
    const r = byId.get(c.id);
    const duplicate = !!r.duplicate; // photo en double, constaté par le serveur
    if (c.placePoints === r.place_points && !!c.duplicate === duplicate) continue;
    const now = await getCapture(c.id); // relue : ne pas écraser une modification faite entre-temps
    if (now) { await addCapture({ ...now, placePoints: r.place_points, duplicate }); n++; }
  }
  return n;
}

/**
 * Classement : country null = mondial, sinon code ISO ; month = une date du mois (AAAA-MM-JJ) ou null.
 * Renvoie [{ rank, pseudo, country, points, captures, isMe }].
 */
export async function fetchLeaderboard({ country = null, month = null, limit = 100 } = {}) {
  if (!st.enabled || !st.user) throw new Error('Connecte-toi pour voir les classements.');
  const { data, error } = await sb.rpc('leaderboard', { p_country: country, p_month: month, p_limit: limit });
  if (error) throw new Error(frenchError(error));
  return data.map(rankRow);
}
const rankRow = (r) => ({ rank: Number(r.rank), pseudo: r.pseudo, country: r.country, points: Number(r.points), captures: Number(r.captures), isMe: r.is_me });

/* =================== Amis (supabase/migrations/20261105120000_amis.sql) =================== */
async function call(fn, args) {
  if (!st.enabled || !st.user) throw new Error('Connecte-toi d\'abord.');
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(frenchError(error));
  return data;
}
/** Classement entre amis (moi + amis acceptés) ; month = 'AAAA-MM-01' ou null. */
export const fetchFriendsLeaderboard = async ({ month = null } = {}) => (await call('friends_leaderboard', { p_month: month })).map(rankRow);
export const myFriendCode = () => call('my_friend_code');
/** Renvoie 'envoyée', 'acceptée' ou 'inconnu'. */
export const requestFriend = (code) => call('request_friend', { p_code: code });
export const respondFriend = (userId, accept) => call('respond_friend', { p_user: userId, p_accept: accept });
export const removeFriend = (userId) => call('remove_friend', { p_user: userId });
/** [{ userId, state: 'ami' | 'reçue' | 'envoyée' | 'refusée', pseudo, country, code, retryAt }] (retryAt : relance possible, si refusée) */
export const fetchFriends = async () => (await call('my_friends')).map((f) => ({
  userId: f.user_id, state: f.state, pseudo: f.pseudo, country: f.country, code: f.code, retryAt: f.retry_at,
}));
/** Code affiché en deux blocs : ABCD-EFGH. */
export const formatFriendCode = (c) => (c && c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c || '');

/**
 * Copie allégée pour le serveur (~1 Mo → ~450 Ko) : JPEG 80 %, au plus 1920 px de large/haut.
 * La photo d'origine reste intacte sur le téléphone. En cas de souci, on envoie l'original.
 */
const UPLOAD_MAX_SIDE = 1920;
const UPLOAD_QUALITY = 0.8;
export async function compressForUpload(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, UPLOAD_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (bmp.close) bmp.close();
    const out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', UPLOAD_QUALITY));
    return out && out.size < blob.size ? out : blob;
  } catch (e) {
    console.warn('compression', e);
    return blob;
  }
}

async function downloadPhoto(path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error) { console.warn('photo', path, error); return null; }
  return data;
}

const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);
// Champs d'identification, modifiables après l'envoi (et recopiés d'un appareil à l'autre).
const ID_FIELDS = [
  ['typeId', 'type_id'],
  ['registration', 'registration'],
  ['registrationSource', 'registration_source'],
  ['registryModel', 'registry_model'],
  ['militaryAckAt', 'military_ack_at', isoOrNull],
];

function toRow(c, uid, photoPath) {
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
    capture_token: c.captureToken ?? null,
    military_ack_at: c.militaryAckAt ?? null,
  };
}

function fromRow(r, uid) {
  return {
    id: r.client_id,
    takenAt: new Date(r.taken_at).toISOString(),
    photo: null,
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
    militaryAckAt: isoOrNull(r.military_ack_at),
    captureToken: r.capture_token ?? null,
    userAgent: r.user_agent,
    ownerId: uid,
    syncState: 'synced',
    photoPath: r.photo_path,
    rev: 0,
  };
}

/* =================== Messages d'erreur =================== */
function isAlreadyExists(e) {
  const s = `${e.statusCode || e.status || ''} ${e.error || ''} ${e.message || ''}`;
  return /409|Duplicate|already exists/i.test(s);
}

function frenchError(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (e && e.code === '23505') return /pkey/.test(m) ? 'Ton profil existe déjà.' : 'Ce pseudo est déjà pris.';
  if (/expired or is invalid|invalid.*otp|otp.*invalid/i.test(m)) return 'Code invalide ou expiré.';
  if (/rate limit|only request this after|too many/i.test(m)) return 'Trop de demandes : attends un peu avant de réessayer.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Pas de connexion au serveur.';
  if (/invalid.*email|email.*invalid|validate email/i.test(m)) return 'Adresse courriel invalide.';
  if (/signups not allowed/i.test(m)) return 'Les inscriptions sont fermées pour le moment.';
  return m;
}
