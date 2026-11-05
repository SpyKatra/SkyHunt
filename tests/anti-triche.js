// Anti-triche serveur et avertissement militaire (supabase/migrations/20261106120000_anti_triche.sql) :
//   npx supabase start        (à la racine du dépôt, Docker requis ; démarre aussi la fonction Edge photo-hash)
//   node tests/anti-triche.js
// Contrôle : jetons de capture (usage unique, heure minimale, réserve limitée), captures antidatées sans
// jeton (datées à la réception), militaire sans avertissement accepté = 0 point, photos en double
// détectées par le serveur (fonction Edge + déclencheur), et accès réservés.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function localEnv() {
  if (process.env.SB_URL) return { url: process.env.SB_URL, key: process.env.SB_KEY, secret: process.env.SB_SECRET };
  const out = execSync('npx --yes supabase@3.0.0 status -o json', { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const s = JSON.parse(out.slice(out.indexOf('{')));
  return { url: s.API_URL, key: s.PUBLISHABLE_KEY || s.ANON_KEY, secret: s.SECRET_KEY || s.SERVICE_ROLE_KEY };
}

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${extra !== '' ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

(async () => {
  const env = localEnv();
  const admin = createClient(env.url, env.secret, opts);
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);
  const dir = path.join(os.tmpdir(), `skyhunt-photos-${stamp}`);
  execSync(`python "${path.join(__dirname, 'make_photos.py')}" "${dir}"`);
  const photo = (name) => new Blob([fs.readFileSync(path.join(dir, name))], { type: 'image/jpeg' });

  async function player(name) {
    const email = `${name}${stamp}@test.skyhunt`;
    const password = `Mdp-${stamp}-${name}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const sb = createClient(env.url, env.key, opts);
    await sb.auth.signInWithPassword({ email, password });
    await sb.from('profiles').insert({ id: data.user.id, pseudo: `${name}${tag}`, country: 'CA' });
    return { sb, id: data.user.id, pseudo: `${name}${tag}` };
  }
  const A = await player('Anti');
  const B = await player('Bravo');

  // Lieu propre à ce passage (aucune autre capture à moins de 5 km).
  const lat = -40 + (stamp % 1000) / 100;
  const lon = -140 - (stamp % 7);
  const cap = (id, takenAt, extra = {}) => ({
    client_id: `${id}-${tag}`, taken_at: takenAt, latitude: lat, longitude: lon, accuracy_m: 5,
    confidence: 0.7, size_ratio: 0.3, sharpness: 900, brightness: 150, moire: 5, screen_object: 0,
    valid: true, reasons: [], type_id: 'saab340', ...extra,
  });
  const insert = async (P, row) => {
    const { data, error } = await P.sb.from('captures').insert(row).select('client_id, verified').single();
    if (error) throw new Error(`${row.client_id} : ${error.message}`);
    return data;
  };
  const scores = async (P) => {
    const { data, error } = await P.sb.rpc('my_scores');
    if (error) throw error;
    return Object.fromEntries(data.map((r) => [r.client_id.replace(`-${tag}`, ''), r]));
  };

  // ---------- Jetons
  const { data: toks, error: eTok } = await A.sb.rpc('issue_capture_tokens', { p_count: 50 });
  check('jetons : au plus 20 en réserve', !eTok && toks.length === 20, eTok ? eTok.message : toks.length);
  const { data: toks2 } = await A.sb.rpc('issue_capture_tokens', { p_count: 5 });
  check('réserve pleine : aucun nouveau jeton', toks2.length === 0, toks2.length);
  const now = () => new Date().toISOString();
  let r = await insert(A, cap('a1', now(), { capture_token: toks[0].token }));
  check('jeton valide → capture vérifiée', r.verified === true);
  r = await insert(A, cap('a2', now(), { capture_token: toks[0].token, type_id: 'dash8-400' }));
  check('jeton déjà utilisé → non vérifiée', r.verified === false);
  r = await insert(A, cap('a3', new Date(Date.now() - 3600e3).toISOString(), { capture_token: toks[1].token, type_id: 'a320' }));
  check('photo datée d\'avant le jeton → non vérifiée', r.verified === false);
  r = await insert(A, cap('a4', now(), { type_id: 'b737-800', verified: true }));
  check('« verified » imposé par le client ignoré', r.verified === false);
  const { data: tokB } = await B.sb.rpc('issue_capture_tokens', { p_count: 1 });
  r = await insert(A, cap('a5', now(), { capture_token: tokB[0].token, type_id: 'a321' }));
  check('jeton d\'un autre joueur → non vérifiée', r.verified === false);
  const { error: eUpd } = await A.sb.from('captures').update({ registration: 'C-GXXX' }).eq('client_id', `a1-${tag}`);
  check('identification toujours modifiable', !eUpd, eUpd && eUpd.message);
  const { error: eVer } = await A.sb.from('captures').update({ verified: true }).eq('client_id', `a2-${tag}`);
  check('« verified » non modifiable', !!eVer, eVer && eVer.message);
  const { error: eTokAnon } = await createClient(env.url, env.key, opts).rpc('issue_capture_tokens', {});
  check('jetons refusés sans compte', !!eTokAnon);

  // ---------- Antidater ne fait pas passer avant les autres (rareté des lieux)
  // B photographie un lieu neuf maintenant (vérifiée) → 5 pts de lieu. A envoie ensuite une capture du même lieu
  // « prise hier » sans jeton : elle compte à son heure de réception, donc après B → 3 pts de lieu, et B garde 5.
  const lat2 = lat + 1;
  const { data: tokB2 } = await B.sb.rpc('issue_capture_tokens', { p_count: 1 });
  await insert(B, { ...cap('b1', now(), { capture_token: tokB2[0].token }), latitude: lat2 });
  await insert(A, { ...cap('a6', new Date(Date.now() - 86400e3).toISOString(), { type_id: 'atr72' }), latitude: lat2 });
  const sA = await scores(A);
  const sB = await scores(B);
  check('capture antidatée sans jeton : comptée à sa réception (3 pts de lieu)', sA.a6.place_points === 3, sA.a6.place_points);
  check('le premier vrai capteur garde 5 pts de lieu', sB.b1.place_points === 5, sB.b1.place_points);

  // ---------- Militaire
  await insert(A, cap('m1', now(), { type_id: 'f18' }));
  await insert(A, cap('m2', now(), { type_id: 'c17', military_ack_at: now() }));
  let sm = await scores(A);
  check('militaire sans avertissement accepté : 0 point', sm.m1.points === 0, sm.m1.points);
  check('militaire avec avertissement accepté : points', sm.m2.points > 0, sm.m2.points);
  const { error: eAck } = await A.sb.from('captures').update({ military_ack_at: now() }).eq('client_id', `m1-${tag}`);
  sm = await scores(A);
  check('avertissement accepté après coup (changement de type) : la capture compte', !eAck && sm.m1.points > 0, eAck ? eAck.message : sm.m1.points);
  const { data: types } = await A.sb.from('aircraft_types').select('id').eq('military', true);
  const { AIRCRAFT } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'web', 'catalog.js')).href);
  const mil = AIRCRAFT.filter((t) => t.category === 'militaire').map((t) => t.id).sort();
  check('types militaires du serveur = catalogue', types.map((t) => t.id).sort().join() === mil.join(), `${types.length} / ${mil.length}`);

  // ---------- Photos en double (empreinte calculée par le serveur)
  async function withPhoto(P, id, file, extra = {}) {
    const p = `${P.id}/${id}-${tag}.jpg`;
    const { error } = await P.sb.storage.from('captures').upload(p, photo(file), { contentType: 'image/jpeg' });
    if (error) throw new Error(`photo ${id} : ${error.message}`);
    await insert(P, { ...cap(id, now(), extra), photo_path: p, latitude: lat + 2 });
  }
  const waitHash = async (P, id) => {
    for (let i = 0; i < 60; i++) {
      const out = execSync(`docker exec supabase_db_skyhunt psql -U postgres -tAc "select coalesce(round(similarity::numeric,3)::text,'-') from private.photo_hashes where user_id='${P.id}' and client_id='${id}-${tag}'"`).toString().trim();
      if (out) return out;
      await sleep(500);
    }
    return null;
  };
  await withPhoto(A, 'p1', 'original.jpg', { type_id: 'b787' });
  check('empreinte calculée par le serveur (photo 1)', (await waitHash(A, 'p1')) != null);
  await withPhoto(B, 'p2', 'copie.jpg', { type_id: 'b787' });
  const d2 = await waitHash(B, 'p2');
  await withPhoto(B, 'p3', 'autre.jpg', { type_id: 'b787', registration: 'C-FAAA' });
  const d3 = await waitHash(B, 'p3');
  const sp = await scores(B);
  check('copie recompressée et réduite d\'une photo d\'un autre joueur : double, 0 point', sp.p2.duplicate === true && sp.p2.points === 0,
    `ressemblance ${d2}, ${JSON.stringify(sp.p2)}`);
  check('autre photo : pas un double, des points', sp.p3.duplicate === false && sp.p3.points > 0, `ressemblance ${d3}, ${JSON.stringify(sp.p3)}`);
  const sp1 = await scores(A);
  check('l\'original garde ses points', sp1.p1.duplicate === false && sp1.p1.points > 0, JSON.stringify(sp1.p1));
  const { data: lb } = await B.sb.rpc('leaderboard', {});
  const rowB = lb.find((x) => x.pseudo === B.pseudo);
  check('classement : le double ne compte pas comme carte', rowB && Number(rowB.captures) === 2, rowB && rowB.captures);

  const { error: eRec } = await A.sb.rpc('record_photo_hash', { p_path: `${A.id}/x.jpg`, p_thumb: Array(192).fill(0) });
  check('enregistrement d\'empreinte interdit aux joueurs', !!eRec, eRec && eRec.message);
  const { error: eHash } = await A.sb.schema('private').from('photo_hashes').select('*').limit(1);
  check('empreintes inaccessibles', !!eHash);
  // Rappeler la fonction ne change rien (première empreinte gardée)
  const res = await fetch(`${env.url}/functions/v1/photo-hash`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `${B.id}/p2-${tag}.jpg` }) });
  const j = await res.json().catch(() => ({}));
  check('rappeler la fonction ne change rien', res.ok && j.deja === true, JSON.stringify(j));
  const bad = await fetch(`${env.url}/functions/v1/photo-hash`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"path":"../x"}' });
  check('chemin invalide refusé', bad.status === 400, bad.status);

  for (const P of [A, B]) await admin.auth.admin.deleteUser(P.id);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
