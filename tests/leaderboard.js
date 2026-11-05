// Classements et points calculés par le serveur (supabase/migrations/20261104120000_classements.sql) :
//   npx supabase start        (à la racine du dépôt, Docker requis)
//   node tests/leaderboard.js
// Contrôle : catalogue du serveur = web/catalog.js, points du serveur = recomputeAll de web/game.js
// (avec les points de lieu du serveur), rareté des lieux, classements mondial / national / mensuel,
// et confidentialité (rien de lisible sans compte, ni positions ni captures des autres).
const { execSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
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
const YQB = [46.7911, -71.3933];
const YUL = [45.4706, -73.7408];
const CDG = [49.0097, 2.5479];

(async () => {
  const env = localEnv();
  const { AIRCRAFT, RARITIES } = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'catalog.js')).href);
  const { recomputeAll } = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'game.js')).href);
  const admin = createClient(env.url, env.secret, opts);
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);

  // Base propre pour la rareté des lieux : on travaille dans un mois du passé, sans autres captures.
  // (Les captures d'autres tests, prises « maintenant », sont plus récentes et ne comptent donc pas.)
  const base = Date.UTC(2020, 0, 10, 12); // 10 janvier 2020
  const at = (days, min = 0) => new Date(base + days * 86400000 + min * 60000).toISOString();
  // Nettoie d'éventuelles captures d'un passage précédent dans cette période.
  await admin.from('captures').delete().lt('taken_at', '2020-12-31T00:00:00Z');

  async function player(name, country) {
    const email = `${name}${stamp}@test.skyhunt`;
    const password = `Mdp-${stamp}-${name}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const sb = createClient(env.url, env.key, opts);
    const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    const { error: e3 } = await sb.from('profiles').insert({ id: data.user.id, pseudo: `${name}${tag}`, country });
    if (e3) throw e3;
    return { sb, id: data.user.id, pseudo: `${name}${tag}` };
  }

  // --- Catalogue : serveur = web/catalog.js
  const A = await player('Alpha', 'CA');
  const B = await player('Bravo', 'CA');
  const C = await player('Charlie', 'FR');
  {
    const { data: types } = await A.sb.from('aircraft_types').select('id, rarity');
    const { data: rar } = await A.sb.from('rarities').select('id, points');
    const map = Object.fromEntries((types || []).map((t) => [t.id, t.rarity]));
    const diff = AIRCRAFT.filter((a) => map[a.id] !== a.rarity).map((a) => a.id);
    check('types du serveur = web/catalog.js', types && types.length === AIRCRAFT.length && diff.length === 0,
      `${types && types.length} / ${AIRCRAFT.length}${diff.length ? ` ; différents : ${diff.join(', ')}` : ''}`);
    const rdiff = Object.entries(RARITIES).filter(([id, r]) => !(rar || []).some((x) => x.id === id && x.points === r.points));
    check('raretés du serveur = web/catalog.js', rdiff.length === 0, rdiff.map(([id]) => id).join(', '));
  }

  // --- Captures (heures croissantes ; jour 0 = janvier, jours 25+ = février)
  const cap = (id, days, [lat, lon], extra = {}) => ({
    client_id: id, taken_at: at(days), latitude: lat, longitude: lon, accuracy_m: 5,
    confidence: 0.7, size_ratio: 0.3, sharpness: 900, brightness: 150, moire: 5, screen_object: 0,
    valid: true, reasons: [], type_id: 'saab340', ...extra,
  });
  const caps = {
    A: [
      cap('a1', 0, YQB, { registration: 'C-FJEP' }),                       // lieu découvert : 5
      cap('a2', 1, YQB, { registration: 'C-GABC' }),                       // 2e Saab 340 : R = 0,5, lieu 3
      cap('a3', 2, YQB, { registration: 'C-F-JEP' }),                      // même immatriculation : 0
      cap('a4', 3, YQB, { type_id: 'a220-300', confidence: 0.9, size_ratio: 0.5 }), // excellente : Q = 1,2
      cap('a5', 4, YQB, { valid: false, reasons: ['Trop loin'] }),         // refusée : 0
      cap('a6', 30, YUL, { type_id: 'inconnu' }),                          // février, mystère, lieu découvert
      cap('a7', 31, YQB, { type_id: 'u2', military_ack_at: at(31) }),      // légendaire militaire (avertissement accepté), février
    ],
    B: [
      cap('b1', 5, YQB, { type_id: 'saab340' }),                          // 4 captures valides avant à YQB : 3
      cap('b2', 32, YQB, { type_id: 'a220-300' }),
    ],
    C: [
      cap('c1', 6, CDG, { type_id: 'a220-300' }),                          // lieu découvert : 5
    ],
  };
  for (const [who, P] of [['A', A], ['B', B], ['C', C]]) {
    const { error } = await P.sb.from('captures').insert(caps[who]);
    check(`envoi des captures de ${who}`, !error, error && error.message);
  }
  // Captures datées de 2020 : sans jeton, le serveur les daterait à leur réception (anti-triche). Le test
  // simule des captures « vérifiées » (jeton valide à l'époque) en posant verified directement dans la base
  // locale, déclencheurs coupés le temps de la requête.
  const ids = Object.values(caps).flat().map((c) => `'${c.client_id}'`).join(',');
  execSync(`docker exec supabase_db_skyhunt psql -U postgres -v ON_ERROR_STOP=1 -c "set session_replication_role = replica; update public.captures set verified = true where client_id in (${ids.replace(/"/g, '')})"`,
    { stdio: 'pipe' });

  // --- Points du serveur = recomputeAll (avec les points de lieu du serveur)
  async function compare(who, P) {
    const { data, error } = await P.sb.rpc('my_scores');
    check(`my_scores de ${who}`, !error && data && data.length === caps[who].length, error ? error.message : `${data && data.length} lignes`);
    if (!data) return {};
    const server = Object.fromEntries(data.map((r) => [r.client_id, r]));
    const local = recomputeAll(caps[who].map((c) => ({
      id: c.client_id, takenAt: c.taken_at, valid: c.valid, typeId: c.type_id, registration: c.registration || null,
      confidence: c.confidence, sizeRatio: c.size_ratio, placePoints: server[c.client_id] && server[c.client_id].place_points,
      militaryAckAt: c.military_ack_at || null, duplicate: server[c.client_id] && server[c.client_id].duplicate,
    })));
    const diff = local.filter((l) => server[l.id].points !== l.points).map((l) => `${l.id} serveur ${server[l.id].points} / app ${l.points}`);
    check(`points de ${who} : serveur = web/game.js`, diff.length === 0, diff.join(' ; '));
    return server;
  }
  const sA = await compare('A', A);
  const sB = await compare('B', B);
  const sC = await compare('C', C);

  // --- game.js : militaire sans avertissement et photo en double = 0 point (comme le serveur)
  {
    const base = { takenAt: at(40), valid: true, confidence: 0.7, sizeRatio: 0.3, placePoints: 5 };
    const [m0, m1, d1, n1] = recomputeAll([
      { ...base, id: 'm0', typeId: 'f22' },
      { ...base, id: 'm1', typeId: 'f22', militaryAckAt: at(40) },
      { ...base, id: 'd1', typeId: 'a380', duplicate: true },
      { ...base, id: 'n1', typeId: 'a380' },
    ]);
    check('game.js : militaire sans avertissement = 0, bloqué', m0.points === 0 && /militaire/.test(m0.breakdown.blocked), JSON.stringify(m0.breakdown));
    check('game.js : militaire avec avertissement = points, premier du type', m1.points === 40 && m1.breakdown.bonus === 5, m1.points);
    check('game.js : double = 0 et ne compte pas pour la répétition', d1.points === 0 && n1.breakdown.repeat === 0 && n1.points > 0, `${d1.points} / ${n1.points}`);
  }

  // --- Rareté des lieux
  check('lieu découvert = 5 points', sA.a1 && sA.a1.place_points === 5 && sC.c1.place_points === 5 && sA.a6.place_points === 5,
    `a1 ${sA.a1 && sA.a1.place_points}, c1 ${sC.c1 && sC.c1.place_points}, a6 ${sA.a6 && sA.a6.place_points}`);
  check('captures précédentes de tous les joueurs comptées (4 avant → 3)', sB.b1 && sB.b1.place_points === 3, `b1 ${sB.b1 && sB.b1.place_points}`);
  check('capture refusée non comptée dans la rareté', sB.b1 && sB.b1.place_points === 3);
  // Détail attendu de A (vérifié à la main) :
  //  a1 : Saab 340 peu commun (5+5)×1×1 + 5 = 15 ; a2 : (5+3)×0,5 = 4 ; a3 : même immatriculation = 0
  //  a4 : round((2+3)×1,2) + 5 = 11 ; a5 : refusée = 0 ; a6 : mystère (2+5) = 7 ; a7 : (30+3) + 5 = 38
  const expectA = { a1: 15, a2: 4, a3: 0, a4: 11, a5: 0, a6: 7, a7: 38 };
  const badA = Object.entries(expectA).filter(([k, v]) => !sA[k] || sA[k].points !== v).map(([k, v]) => `${k} ${sA[k] && sA[k].points} ≠ ${v}`);
  check('points de A conformes au calcul à la main', badA.length === 0, badA.join(' ; '));
  const totA = Object.values(expectA).reduce((s, v) => s + v, 0);

  // --- Classements
  const rows = async (P, args) => {
    const { data, error } = await P.sb.rpc('leaderboard', args);
    if (error) throw error;
    return data.filter((r) => [A.pseudo, B.pseudo, C.pseudo].includes(r.pseudo));
  };
  const world = await rows(A, {});
  const wA = world.find((r) => r.pseudo === A.pseudo);
  check('mondial : total de A', wA && Number(wA.points) === totA && Number(wA.captures) === 6, wA && `${wA.points} pts, ${wA.captures} captures`);
  check('mondial : A marqué « moi »', wA && wA.is_me === true && world.filter((r) => r.is_me).length === 1);
  check('mondial : les 3 joueurs, triés', world.length === 3 && world[0].pseudo === A.pseudo
    && world.every((r, i) => i === 0 || Number(r.points) <= Number(world[i - 1].points)), world.map((r) => `${r.pseudo} ${r.points}`).join(', '));
  const nat = await rows(A, { p_country: 'FR' });
  check('national FR : seulement Charlie (+ moi s\'il le faut)', nat.some((r) => r.pseudo === C.pseudo) && !nat.some((r) => r.pseudo === B.pseudo),
    nat.map((r) => `${r.pseudo} ${r.country}`).join(', '));
  const feb = await rows(A, { p_month: '2020-02-15' });
  const fA = feb.find((r) => r.pseudo === A.pseudo);
  check('mensuel (février 2020) : seulement les captures de février', fA && Number(fA.points) === sA.a6.points + sA.a7.points && Number(fA.captures) === 2,
    fA && `${fA.points} pts, ${fA.captures} captures`);
  check('mensuel : Charlie absent (rien en février)', !feb.some((r) => r.pseudo === C.pseudo));
  const top1 = await rows(C, { p_limit: 1 });
  check('limite : le 1er + ma propre ligne', top1.some((r) => r.pseudo === C.pseudo && r.is_me) && top1.length <= 2,
    top1.map((r) => `${r.rank}. ${r.pseudo}`).join(', '));
  check('pas de positions ni d\'id dans le classement', world.every((r) => !('latitude' in r) && !('id' in r) && !('user_id' in r)));

  // --- Confidentialité
  const anon = createClient(env.url, env.key, opts);
  const { error: eAnon } = await anon.rpc('leaderboard', {});
  check('classement refusé sans compte', !!eAnon, eAnon && eAnon.message);
  const { data: others } = await A.sb.from('captures').select('client_id').eq('user_id', B.id);
  check('toujours impossible de lire les captures des autres', Array.isArray(others) && others.length === 0);
  const { error: ePriv } = await A.sb.schema('private').from('scored_captures').select('*').limit(1);
  check('vue privée des points inaccessible', !!ePriv, ePriv && ePriv.message);
  const { error: eCat } = await A.sb.from('aircraft_types').insert({ id: 'triche', rarity: 'legendaire' });
  check('catalogue du serveur non modifiable par un joueur', !!eCat, eCat && eCat.message);

  // Nettoyage
  for (const P of [A, B, C]) await admin.auth.admin.deleteUser(P.id);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
