// Amis par code (supabase/migrations/20261105120000_amis.sql) :
//   npx supabase start        (à la racine du dépôt, Docker requis)
//   node tests/friends.js
// Contrôle : code ami fixe, demandes à accepter / refuser, relance 48 h après un refus, limite d'essais,
// classement entre amis, et vie privée (pas de pseudo avant acceptation, tables inaccessibles).
const { execSync } = require('child_process');
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
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
// SQL direct sur la base locale (pour simuler le temps qui passe).
const DB = process.env.SB_DB_CONTAINER || 'supabase_db_skyhunt';
const sql = (q) => execSync(`docker exec ${DB} psql -U postgres -v ON_ERROR_STOP=1 -c "${q.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });

(async () => {
  const env = localEnv();
  const admin = createClient(env.url, env.secret, opts);
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);

  async function player(name, country, withProfile = true) {
    const email = `${name}${stamp}@test.skyhunt`;
    const password = `Mdp-${stamp}-${name}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const sb = createClient(env.url, env.key, opts);
    const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    if (withProfile) {
      const { error: e3 } = await sb.from('profiles').insert({ id: data.user.id, pseudo: `${name}${tag}`, country });
      if (e3) throw e3;
    }
    return { sb, id: data.user.id, pseudo: `${name}${tag}` };
  }
  const rpc = async (P, fn, args) => { const { data, error } = await P.sb.rpc(fn, args); return { data, error: error && error.message }; };
  const friends = async (P) => (await rpc(P, 'my_friends')).data || [];

  const A = await player('Ami', 'CA');
  const B = await player('Bob', 'CA');
  const C = await player('Cleo', 'FR');
  const D = await player('Dan', 'US');
  const N = await player('Nopseudo', 'CA', false);
  const all = [A, B, C, D, N];

  // --- Codes
  const { data: codeA } = await rpc(A, 'my_friend_code');
  const { data: codeA2 } = await rpc(A, 'my_friend_code');
  const { data: codeB } = await rpc(B, 'my_friend_code');
  const { data: codeC } = await rpc(C, 'my_friend_code');
  check('code ami : 8 caractères sans 0, O, 1, I', /^[2-9A-HJ-NP-Z]{8}$/.test(codeA || ''), codeA);
  check('le code ne change pas d\'un appel à l\'autre', codeA === codeA2);
  check('codes différents entre joueurs', codeA !== codeB && codeB !== codeC);

  // --- Demandes
  let r = await rpc(A, 'request_friend', { p_code: 'ZZZZZZZZ' });
  check('code inconnu : « inconnu »', r.data === 'inconnu', r.error || r.data);
  r = await rpc(A, 'request_friend', { p_code: codeA });
  check('son propre code refusé', /propre code/.test(r.error || ''), r.error);
  r = await rpc(N, 'request_friend', { p_code: codeA });
  check('pas de demande sans pseudo', /pseudo/.test(r.error || ''), r.error);

  // Code tapé en minuscules avec un tiret : accepté
  r = await rpc(A, 'request_friend', { p_code: `${codeB.slice(0, 4).toLowerCase()}-${codeB.slice(4).toLowerCase()}` });
  check('A → B : demande envoyée (minuscules et tiret acceptés)', r.data === 'envoyée', r.error || r.data);
  let fa = await friends(A);
  let fb = await friends(B);
  const outA = fa.find((f) => f.user_id === B.id);
  check('A voit sa demande « envoyée » sans le pseudo de B', outA && outA.state === 'envoyée' && outA.pseudo == null && outA.code === codeB,
    JSON.stringify(outA));
  const inB = fb.find((f) => f.user_id === A.id);
  check('B voit la demande « reçue » avec le pseudo de A', inB && inB.state === 'reçue' && inB.pseudo === A.pseudo && inB.country === 'CA', JSON.stringify(inB));
  r = await rpc(A, 'request_friend', { p_code: codeB });
  check('renvoyer la même demande ne crée pas de doublon', r.data === 'envoyée' && (await friends(A)).length === 1, r.error);

  // Classement entre amis avant acceptation : A seul
  let lbA = (await rpc(A, 'friends_leaderboard', {})).data || [];
  check('demande non acceptée : pas dans le classement entre amis', lbA.length === 1 && lbA[0].is_me, JSON.stringify(lbA));

  r = await rpc(C, 'respond_friend', { p_user: A.id, p_accept: true });
  check('un tiers ne peut pas accepter la demande', /introuvable/.test(r.error || ''), r.error);
  r = await rpc(B, 'respond_friend', { p_user: A.id, p_accept: true });
  check('B accepte', !r.error, r.error);
  fa = await friends(A);
  check('A et B sont amis, pseudo visible', fa.some((f) => f.user_id === B.id && f.state === 'ami' && f.pseudo === B.pseudo), JSON.stringify(fa));
  r = await rpc(B, 'request_friend', { p_code: codeA });
  check('déjà amis : message clair', /déjà amis/.test(r.error || ''), r.error);

  // Demande croisée : C → A puis A → C = amis tout de suite
  await rpc(C, 'request_friend', { p_code: codeA });
  r = await rpc(A, 'request_friend', { p_code: codeC });
  check('demandes croisées : amis tout de suite', r.data === 'acceptée', r.error || r.data);

  // Refus : D → B, B refuse ; relance seulement après 48 h
  const { data: codeD } = await rpc(D, 'my_friend_code');
  await rpc(D, 'request_friend', { p_code: codeB });
  r = await rpc(B, 'respond_friend', { p_user: D.id, p_accept: false });
  check('B refuse D', !r.error, r.error);
  let outD = (await friends(D)).find((f) => f.user_id === B.id);
  const retryH = outD && (new Date(outD.retry_at) - Date.now()) / 3600000;
  check('D voit « refusée », relance dans 48 h, sans pseudo', outD && outD.state === 'refusée' && outD.pseudo == null && retryH > 47.9 && retryH <= 48,
    JSON.stringify(outD));
  check('le refus disparaît de la liste de B', !(await friends(B)).some((f) => f.user_id === D.id));
  r = await rpc(D, 'request_friend', { p_code: codeB });
  check('D ne peut pas relancer avant 48 h', /relancer dans 48 h/.test(r.error || '') && !(await friends(B)).some((f) => f.user_id === D.id), r.error);
  await rpc(D, 'remove_friend', { p_user: B.id });
  check('effacer le refus avant 48 h : impossible', (await friends(D)).some((f) => f.user_id === B.id && f.state === 'refusée'));
  // 47 h plus tard : toujours bloqué ; 49 h plus tard : relance possible
  const backdate = (h) => sql(`update private.friendships set responded_at = now() - interval '${h} hours' where requester = '${D.id}' and addressee = '${B.id}'`);
  backdate(47);
  r = await rpc(D, 'request_friend', { p_code: codeB });
  check('après 47 h : encore bloqué', /relancer dans 1 h/.test(r.error || ''), r.error);
  backdate(49);
  r = await rpc(D, 'request_friend', { p_code: codeB });
  check('après 48 h : relance possible', r.data === 'envoyée' && (await friends(B)).some((f) => f.user_id === D.id && f.state === 'reçue'), r.error || r.data);
  outD = (await friends(D)).find((f) => f.user_id === B.id);
  check('la relance redevient « envoyée »', outD && outD.state === 'envoyée' && outD.retry_at == null, JSON.stringify(outD));
  await rpc(B, 'respond_friend', { p_user: D.id, p_accept: false });
  backdate(49);
  await rpc(D, 'remove_friend', { p_user: B.id });
  check('après 48 h : D peut effacer le refus', !(await friends(D)).some((f) => f.user_id === B.id));
  // Le refus de B ne l'empêche pas de demander D lui-même
  await rpc(D, 'request_friend', { p_code: codeB });
  await rpc(B, 'respond_friend', { p_user: D.id, p_accept: false });
  r = await rpc(B, 'request_friend', { p_code: codeD });
  check('B peut quand même demander D plus tard', r.data === 'envoyée' && (await friends(D)).some((f) => f.user_id === B.id && f.state === 'reçue'),
    r.error || r.data);
  await rpc(B, 'remove_friend', { p_user: D.id });
  check('B annule sa demande à D', !(await friends(D)).some((f) => f.user_id === B.id));

  // --- Classement entre amis (captures « maintenant », mois courant)
  const now = new Date();
  const cap = (id, typeId) => ({
    client_id: `ami-${id}-${stamp}`, taken_at: now.toISOString(), latitude: 10 + Math.random(), longitude: 120 + Math.random(), accuracy_m: 5,
    confidence: 0.7, size_ratio: 0.3, sharpness: 900, brightness: 150, moire: 5, screen_object: 0,
    valid: true, reasons: [], type_id: typeId,
  });
  await A.sb.from('captures').insert([cap('a1', 'a380')]);
  await B.sb.from('captures').insert([cap('b1', 'saab340'), cap('b2', 'dash7')]);
  await D.sb.from('captures').insert([cap('d1', 'an124')]);
  lbA = (await rpc(A, 'friends_leaderboard', {})).data || [];
  const names = lbA.map((x) => x.pseudo);
  check('classement de A : A, B et C, pas D', names.length === 3 && names.includes(B.pseudo) && names.includes(C.pseudo) && !names.includes(D.pseudo),
    lbA.map((x) => `${x.rank}. ${x.pseudo} ${x.points}`).join(', '));
  check('classement trié par points', lbA.every((x, i) => i === 0 || Number(lbA[i - 1].points) >= Number(x.points)));
  const { data: world } = await rpc(A, 'leaderboard', {});
  const pw = (P) => Number(((world || []).find((x) => x.pseudo === P.pseudo) || {}).points);
  const pf = (P) => Number((lbA.find((x) => x.pseudo === P.pseudo) || {}).points);
  check('mêmes points que le classement mondial', pf(A) === pw(A) && pf(B) === pw(B), `A ${pf(A)}/${pw(A)}, B ${pf(B)}/${pw(B)}`);
  const lbMonth = (await rpc(A, 'friends_leaderboard', { p_month: `${now.toISOString().slice(0, 7)}-01` })).data || [];
  check('classement entre amis du mois', lbMonth.length === 3 && Number(lbMonth.find((x) => x.is_me).points) === pf(A));
  const lbOld = (await rpc(A, 'friends_leaderboard', { p_month: '2001-01-01' })).data || [];
  check('mois sans capture : 0 point', lbOld.every((x) => Number(x.points) === 0));
  check('pas d\'id ni de position dans le classement', lbA.every((x) => !('user_id' in x) && !('id' in x) && !('latitude' in x)));

  // Retirer un ami
  await rpc(B, 'remove_friend', { p_user: A.id });
  check('B retire A : plus amis des deux côtés', !(await friends(A)).some((f) => f.user_id === B.id) && !(await friends(B)).some((f) => f.user_id === A.id));

  // --- Code fixe
  const { data: codeA3 } = await rpc(A, 'my_friend_code');
  check('code fixe : toujours le même', codeA3 === codeA);
  r = await rpc(A, 'new_friend_code');
  check('pas de changement de code', !!r.error, r.error);

  // --- Limite d'essais (20 par heure) : D a déjà fait 4 essais
  let blocked = null;
  for (let i = 0; i < 25 && !blocked; i++) {
    const x = await rpc(D, 'request_friend', { p_code: 'ZZZZZZZ' + (i % 8 + 2) });
    if (/Trop d'essais/.test(x.error || '')) blocked = i;
  }
  check('limite de 20 essais par heure', blocked != null, `bloqué après ${blocked == null ? '?' : blocked + 4} essais`);
  r = await rpc(D, 'request_friend', { p_code: codeC });
  check('même un bon code est bloqué une fois la limite atteinte', /Trop d'essais/.test(r.error || ''), r.error);

  // --- Vie privée
  const anon = createClient(env.url, env.key, opts);
  for (const fn of ['my_friend_code', 'my_friends', 'friends_leaderboard']) {
    const { error } = await anon.rpc(fn, {});
    check(`${fn} refusé sans compte`, !!error, error && error.message);
  }
  const { error: eTab } = await A.sb.schema('private').from('friend_codes').select('*').limit(1);
  check('table des codes inaccessible', !!eTab, eTab && eTab.message);
  const { error: eF } = await A.sb.schema('private').from('friendships').select('*').limit(1);
  check('table des amitiés inaccessible', !!eF, eF && eF.message);
  const { data: profB } = await A.sb.from('profiles').select('*').eq('id', C.id);
  check('profil d\'un ami toujours illisible directement', Array.isArray(profB) && profB.length === 0);

  // Suppression du compte : amitiés et code partent avec
  await admin.auth.admin.deleteUser(C.id);
  check('compte supprimé : disparaît des amis', !(await friends(A)).some((f) => f.user_id === C.id));

  for (const P of all) if (P !== C) await admin.auth.admin.deleteUser(P.id);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
