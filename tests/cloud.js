// Vérifie les règles du serveur (supabase/migrations) sur l'instance locale :
//   npx supabase start        (à la racine du dépôt, Docker requis)
//   node tests/cloud.js
// Contrôle : connexion par code reçu par courriel, profils, isolement entre joueurs (RLS),
// mesures figées, photos privées et non remplaçables, suppression du compte.
const { execSync } = require('child_process');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function localEnv() {
  if (process.env.SB_URL) return { url: process.env.SB_URL, key: process.env.SB_KEY, secret: process.env.SB_SECRET, mail: process.env.SB_MAIL };
  const out = execSync('npx --yes supabase@3.0.0 status -o json', { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const s = JSON.parse(out.slice(out.indexOf('{')));
  return { url: s.API_URL, key: s.PUBLISHABLE_KEY || s.ANON_KEY, secret: s.SECRET_KEY || s.SERVICE_ROLE_KEY, mail: s.MAILPIT_URL || s.INBUCKET_URL };
}

/** Lit le dernier code envoyé à cette adresse dans Mailpit (serveur de courriel local). */
async function codeFromMail(mailUrl, email) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const j = await r.json();
    if (j.messages && j.messages.length) {
      const m = await (await fetch(`${mailUrl}/api/v1/message/${j.messages[0].ID}`)).json();
      const code = (m.Text || m.HTML || '').match(/\b(\d{6})\b/);
      if (code) return { code: code[1], subject: m.Subject };
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`aucun courriel pour ${email}`);
}

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

const jpeg = (n) => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9])], { type: 'image/jpeg' });
const capture = (id, extra = {}) => ({
  client_id: id, taken_at: new Date().toISOString(), latitude: 46.7956, longitude: -71.3821, accuracy_m: 5,
  confidence: 0.82, size_ratio: 0.5, sharpness: 5230, brightness: 167, moire: 8.5, screen_object: 0, valid: true, reasons: [], type_id: 'saab-340', ...extra,
});

(async () => {
  const env = localEnv();
  const stamp = Date.now();
  const emailA = `a${stamp}@test.skyhunt`;
  const emailB = `b${stamp}@test.skyhunt`;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };

  // --- Connexion par code (courriel réel via Mailpit)
  const A = createClient(env.url, env.key, opts);
  const { error: eOtp } = await A.auth.signInWithOtp({ email: emailA });
  check('envoi du code', !eOtp, eOtp && eOtp.message);
  const mail = await codeFromMail(env.mail, emailA);
  check('courriel en français avec code à 6 chiffres', mail.subject === 'Ton code SkyHunt', mail.subject);
  const { data: vA, error: eV } = await A.auth.verifyOtp({ email: emailA, token: mail.code, type: 'email' });
  check('connexion avec le code', !eV && vA.user, eV && eV.message);
  const uidA = vA.user.id;

  const B = createClient(env.url, env.key, opts);
  await B.auth.signInWithOtp({ email: emailB });
  const { code: codeB } = await codeFromMail(env.mail, emailB);
  const { data: vB } = await B.auth.verifyOtp({ email: emailB, token: codeB, type: 'email' });
  const uidB = vB.user.id;

  // --- Profils
  const pseudoA = `Spy${stamp % 100000}`;
  let r = await A.from('profiles').insert({ id: uidA, pseudo: pseudoA, country: 'CA' });
  check('création du profil', !r.error, r.error && r.error.message);
  r = await B.from('profiles').insert({ id: uidB, pseudo: pseudoA.toUpperCase(), country: 'FR' });
  check('pseudo unique (sans tenir compte de la casse)', r.error && r.error.code === '23505', r.error && r.error.code);
  r = await B.from('profiles').insert({ id: uidB, pseudo: `B${stamp % 100000}`, country: 'France' });
  check('pays = code ISO obligatoire', !!r.error);
  r = await B.from('profiles').insert({ id: uidA, pseudo: `Pirate${stamp % 1000}`, country: 'FR' });
  check('impossible de créer le profil d\'un autre', !!r.error);
  r = await B.from('profiles').insert({ id: uidB, pseudo: `B${stamp % 100000}`, country: 'FR' });
  check('profil B', !r.error, r.error && r.error.message);
  const admin = createClient(env.url, env.secret, opts);
  // Pseudo et pays fixés à la création (20261105130000_profil_fige.sql) : seul un administrateur les change.
  r = await A.from('profiles').update({ pseudo: `Autre${stamp % 1000}`, country: 'FR' }).eq('id', uidA).select();
  const { data: profA } = await A.from('profiles').select('pseudo, country').eq('id', uidA).single();
  check('pseudo et pays non modifiables par le joueur', profA.pseudo === pseudoA && profA.country === 'CA', r.error ? r.error.message : JSON.stringify(r.data));
  r = await A.from('profiles').upsert({ id: uidA, pseudo: `Autre${stamp % 1000}`, country: 'FR' });
  check('ni par « upsert »', !!r.error, r.error && r.error.message);
  r = await admin.from('profiles').update({ country: 'FR' }).eq('id', uidA).select();
  check('modifiable par un administrateur', !r.error && r.data[0].country === 'FR', r.error && r.error.message);
  await admin.from('profiles').update({ country: 'CA' }).eq('id', uidA);

  // --- Photos
  r = await A.storage.from('captures').upload(`${uidA}/1.jpg`, jpeg(1), { contentType: 'image/jpeg' });
  check('envoi de photo dans son dossier', !r.error, r.error && r.error.message);
  r = await A.storage.from('captures').upload(`${uidA}/1.jpg`, jpeg(2), { contentType: 'image/jpeg', upsert: true });
  check('photo non remplaçable', !!r.error);
  r = await B.storage.from('captures').upload(`${uidA}/2.jpg`, jpeg(3), { contentType: 'image/jpeg' });
  check('pas d\'envoi dans le dossier d\'un autre', !!r.error);
  r = await B.storage.from('captures').download(`${uidA}/1.jpg`);
  check('photo d\'un autre illisible', !!r.error);
  r = await A.storage.from('captures').upload(`${uidA}/x.png`, new Blob(['x'], { type: 'image/png' }), { contentType: 'image/png' });
  check('JPEG seulement', !!r.error);

  // --- Captures
  const c1 = { ...capture('1'), photo_path: `${uidA}/1.jpg` };
  r = await A.from('captures').insert(c1);
  check('envoi d\'une capture', !r.error, r.error && r.error.message);
  r = await A.from('captures').upsert({ ...c1, user_id: uidA, type_id: 'dash-8' }, { onConflict: 'user_id,client_id' });
  check('renvoi (upsert) avec type corrigé accepté', !r.error, r.error && r.error.message);
  r = await A.from('captures').update({ latitude: 48.85 }).eq('client_id', '1');
  check('position figée', !!r.error);
  r = await A.from('captures').update({ valid: false }).eq('client_id', '1');
  check('validité figée', !!r.error);
  r = await A.from('captures').update({ moire: 0 }).eq('client_id', '1');
  check('mesure anti-écran (moiré) figée', !!r.error);
  r = await A.from('captures').update({ screen_object: 0.9 }).eq('client_id', '1');
  check('mesure anti-écran (écran détecté) figée', !!r.error);
  r = await A.from('captures').insert(capture('ecran-hors-borne', { screen_object: 2 }));
  check('écran détecté : valeur entre 0 et 1', !!r.error);
  r = await A.from('captures').update({ photo_path: `${uidA}/2.jpg` }).eq('client_id', '1');
  check('photo de la capture figée', !!r.error);
  r = await A.from('captures').insert(capture('futur', { taken_at: new Date(Date.now() + 3600e3).toISOString() }));
  check('date dans le futur refusée', !!r.error);
  r = await A.from('captures').insert({ ...capture('3'), photo_path: `${uidB}/3.jpg` });
  check('chemin de photo d\'un autre refusé', !!r.error);
  r = await B.from('captures').insert({ ...capture('9'), user_id: uidA });
  check('impossible d\'envoyer au nom d\'un autre', !!r.error);
  r = await B.from('captures').select('*');
  check('B ne voit pas les captures de A', !r.error && r.data.length === 0, `${r.data && r.data.length} ligne(s)`);
  r = await B.from('profiles').select('*');
  check('B ne voit que son profil', !r.error && r.data.length === 1 && r.data[0].id === uidB);
  r = await A.from('captures').select('type_id, position').eq('client_id', '1').single();
  check('type corrigé + position PostGIS calculée', r.data && r.data.type_id === 'dash-8' && !!r.data.position);
  const anon = createClient(env.url, env.key, opts);
  r = await anon.from('captures').select('*');
  check('rien de lisible sans compte', !!r.error || r.data.length === 0);

  // --- Suppression du compte A
  await A.storage.from('captures').remove([`${uidA}/1.jpg`]);
  r = await A.rpc('delete_my_account');
  check('suppression du compte', !r.error, r.error && r.error.message);
  // admin : créé plus haut (profils)
  r = await admin.from('captures').select('id').eq('user_id', uidA);
  const r2 = await admin.from('profiles').select('id').eq('id', uidA);
  check('captures et profil effacés en cascade', r.data.length === 0 && r2.data.length === 0);
  r = await admin.storage.from('captures').list(uidA);
  check('photos effacées', r.data.length === 0);
  await B.rpc('delete_my_account');

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
