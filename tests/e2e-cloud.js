// Test de bout en bout du compte et de la sauvegarde (instance Supabase locale).
//   npx supabase start                       (racine du dépôt, Docker requis)
//   cd web && python3 -m http.server 8766    (terminal 1)
//   node tests/e2e-cloud.js                  (terminal 2)
// Scénario : téléphone 1 joue sans compte (1 refusée + 1 valide), crée un compte avec le code reçu,
// ses cartes partent sur le serveur ; téléphone 2 se connecte et les récupère (avec la photo) ;
// une suppression sur le téléphone 2 se propage au 1 ; déconnexion ; suppression du compte.
// Pseudo et pays figés. Amis : deux joueurs créés par l'API demandent le téléphone 1 ; il accepte l'un et refuse l'autre.
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const URL_APP = process.env.SKYHUNT_URL || 'http://localhost:8766/';
const shot = (p, name) => p.screenshot({ path: path.join(__dirname, 'shots', `c-${name}.png`) });

function localEnv() {
  const out = execSync('npx --yes supabase@3.0.0 status -o json', { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const s = JSON.parse(out.slice(out.indexOf('{')));
  return { url: s.API_URL, key: s.PUBLISHABLE_KEY || s.ANON_KEY, secret: s.SECRET_KEY || s.SERVICE_ROLE_KEY, mail: s.MAILPIT_URL || s.INBUCKET_URL };
}

async function codeFromMail(mailUrl, email, after) {
  for (let i = 0; i < 40; i++) {
    const j = await (await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const m = (j.messages || []).find((x) => new Date(x.Created) >= after);
    if (m) {
      const full = await (await fetch(`${mailUrl}/api/v1/message/${m.ID}`)).json();
      return full.Text.match(/\b(\d{6})\b/)[1];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('code introuvable');
}

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${extra !== '' ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const env = localEnv();
  const email = `spy${Date.now()}@test.skyhunt`;
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.join(__dirname, 'cam.y4m')}`] });
  const errs = [];

  async function phone(name) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'geolocation'],
      geolocation: { latitude: 46.7956, longitude: -71.3821, accuracy: 5 } });
    await ctx.addInitScript((cfg) => localStorage.setItem('skyhunt.cloud', JSON.stringify(cfg)), { url: env.url, key: env.key });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${name} pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|status of 4\d\d/.test(m.text())) errs.push(`${name}: ${m.text()}`); });
    p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('SUPPRIMER') : d.accept()));
    await p.goto(URL_APP);
    return p;
  }
  async function login(p) {
    await p.click('[data-view="profile"]');
    await p.fill('#a-email', email);
    const t0 = new Date(Date.now() - 1000);
    await p.click('#a-send');
    await p.waitForSelector('#a-code');
    await p.fill('#a-code', await codeFromMail(env.mail, email, t0));
    await p.click('#a-verify');
  }
  const status = (p) => p.textContent('#a-status').catch(() => '');
  const waitSynced = (p) => p.waitForFunction(() => /À jour/.test((document.querySelector('#a-status') || {}).textContent || ''), null, { timeout: 30000 })
    .catch(async (e) => { await shot(p, 'echec'); console.log('   compte :', (await p.textContent('#profile-content').catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)); throw e; });
  const cardsSub = async (p) => { await p.click('[data-view="cards"]'); await p.waitForTimeout(300); return p.textContent('#cards-sub'); };

  // ---------- Téléphone 1 : jeu sans compte
  const p1 = await phone('tél1');
  await p1.click('[data-view="profile"]');
  check('section Compte visible', await p1.isVisible('#a-email'));
  await p1.click('[data-view="camera"]');
  await p1.click('#start');
  await p1.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Trop loin'), null, { timeout: 20000 });
  await p1.click('#shutter');
  await p1.waitForTimeout(600);
  await p1.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Avion identifiable'), null, { timeout: 20000 });
  await p1.click('#shutter');
  await p1.waitForSelector('#auto-confirm', { timeout: 30000 });
  await p1.click('#auto-confirm');
  await p1.waitForSelector('#reveal:not(.hidden)');
  await p1.waitForTimeout(1200);
  await p1.click('#reveal-ok');
  const before = await cardsSub(p1);
  console.log('   avant compte :', before);

  // ---------- Création du compte
  await login(p1);
  await p1.waitForSelector('#a-pseudo', { timeout: 15000 });
  await shot(p1, '1-profil-a-creer');
  const pseudo = `Spy${Date.now() % 1000000}`;
  await p1.fill('#a-pseudo', pseudo);
  await p1.selectOption('#a-country', 'CA');
  await p1.click('#a-create');
  await p1.waitForTimeout(1500);
  console.log('   toast :', await p1.textContent('#toast'), '| pseudo :', await p1.inputValue('#a-pseudo').catch(() => '(absent)'));
  await waitSynced(p1);
  await shot(p1, '2-compte');
  check('profil créé + cartes envoyées', /À jour/.test(await status(p1)), await status(p1));
  check('pseudo affiché', (await p1.textContent('.profile-hero h1')) === pseudo);
  // Points de lieu reçus du serveur → points de la carte et XP recalculés.
  await p1.click('#a-sync');
  await waitSynced(p1);
  await p1.waitForTimeout(500);
  await p1.click('[data-view="cards"]');
  await p1.waitForTimeout(300);
  const pts1 = await p1.textContent('#cards-content .card .card-pts');
  await p1.click('[data-view="profile"]');
  const xp1 = Number((await p1.textContent('.xp-line span')).replace(/\D/g, ''));
  console.log('   points de la carte :', pts1, '| XP :', xp1);

  // ---------- Classement
  await p1.click('[data-view="ranks"]');
  await p1.waitForSelector('#r-list .rk.me', { timeout: 15000 });
  const meRow = (await p1.textContent('#r-list .rk.me')).replace(/\s+/g, ' ');
  await shot(p1, '2b-classement');
  check('classement mondial : ma ligne avec mes points', meRow.includes(pseudo) && Number(await p1.textContent('#r-list .rk.me .rk-pts')) === xp1,
    `${meRow} / XP ${xp1}`);
  await p1.click('[data-scope="pays"]');
  await p1.waitForSelector('#r-list .rk.me', { timeout: 15000 });
  check('classement national (Canada)', (await p1.textContent('.ranks h2')).includes('Canada'), await p1.textContent('.ranks h2'));
  await p1.click('[data-scope="mois"]');
  await p1.waitForSelector('#r-list .rk.me', { timeout: 15000 });
  check('classement du mois', Number(await p1.textContent('#r-list .rk.me .rk-pts')) === xp1);
  await shot(p1, '2c-classement-mois');

  // ---------- Pseudo et pays fixés
  await p1.click('[data-view="profile"]');
  check('pseudo et pays non modifiables (pas de champ)', !(await p1.$('#p-name')) && !(await p1.$('#p-country')));
  check('mention du support', /contacte le support/.test(await p1.textContent('#profile-content')));

  // ---------- Amis (gestion dans le Profil, classement dans Classement)
  const sbOpts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(env.url, env.secret, sbOpts);
  async function botPlayer(name) {
    const mail = `${name}${Date.now()}@test.skyhunt`;
    const pw = `Mdp-${Date.now()}-${name}`;
    const { data } = await admin.auth.admin.createUser({ email: mail, password: pw, email_confirm: true });
    const sb = createClient(env.url, env.key, sbOpts);
    await sb.auth.signInWithPassword({ email: mail, password: pw });
    const ps = `${name}${Date.now() % 100000}`;
    await sb.from('profiles').insert({ id: data.user.id, pseudo: ps, country: 'FR' });
    return { sb, id: data.user.id, pseudo: ps };
  }
  const bob = await botPlayer('Bob');
  const eve = await botPlayer('Eve');
  await p1.waitForFunction(() => /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test((document.querySelector('#friends .fcode b') || {}).textContent || ''), null, { timeout: 15000 });
  const myCode = (await p1.textContent('#friends .fcode b')).trim();
  check('code ami affiché dans le Profil (ABCD-EFGH)', true, myCode);
  // Code inconnu
  await p1.fill('#f-code', 'zzzz-zzzz');
  await p1.click('#f-add button');
  await p1.waitForFunction(() => /Code inconnu/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
  check('code inconnu signalé', true);
  // Bob et Eve demandent le téléphone 1
  for (const P of [bob, eve]) {
    const { data, error } = await P.sb.rpc('request_friend', { p_code: myCode });
    if (error || data !== 'envoyée') throw new Error(`demande ${P.pseudo} : ${error && error.message} ${data}`);
  }
  // En rouvrant le Profil (plus de 10 s après la dernière lecture), la liste est relue
  await p1.click('[data-view="cards"]');
  await p1.waitForTimeout(10500);
  await p1.click('[data-view="profile"]');
  await p1.waitForSelector('.tab[data-view="profile"] .badge', { timeout: 15000 });
  check('pastille sur Profil : 2 demandes', (await p1.textContent('.tab[data-view="profile"] .badge')) === '2');
  await p1.waitForSelector('#friends [data-fact="accept"]', { timeout: 15000 });
  await p1.$eval('#friends', (el) => el.scrollIntoView());
  await shot(p1, '2d-demandes-amis');
  const rowOf = (ps) => p1.locator('#friends .fr', { hasText: ps });
  await rowOf(bob.pseudo).locator('[data-fact="accept"]').click();
  await p1.waitForFunction((ps) => [...document.querySelectorAll('#friends .fr')].some((r) => r.textContent.includes(ps) && r.querySelector('[data-fact="remove"]')), bob.pseudo, { timeout: 15000 });
  await rowOf(eve.pseudo).locator('[data-fact="decline"]').click();
  await p1.waitForFunction((ps) => ![...document.querySelectorAll('#friends .fr')].some((r) => r.textContent.includes(ps)), eve.pseudo, { timeout: 15000 });
  check('Bob accepté, Eve refusée', true);
  check('pastille retirée', (await p1.$('.tab[data-view="profile"] .badge')) === null);
  const { data: eveView } = await eve.sb.rpc('my_friends');
  check('Eve voit « refusée » (relance dans 48 h), sans pseudo', eveView.length === 1 && eveView[0].state === 'refusée' && eveView[0].pseudo == null && !!eveView[0].retry_at,
    JSON.stringify(eveView));
  // Classement entre amis
  await p1.click('[data-view="ranks"]');
  await p1.click('[data-scope="amis"]');
  await p1.waitForFunction((ps) => [...document.querySelectorAll('#r-list .rk')].some((r) => r.textContent.includes(ps)), bob.pseudo, { timeout: 15000 });
  const lbNames = await p1.$$eval('#r-list .rk-name', (els) => els.map((e) => e.textContent));
  check('classement entre amis : moi et Bob, pas Eve', lbNames.length === 2 && !lbNames.some((n) => n.includes(eve.pseudo)), lbNames.join(' | '));
  check('pas de gestion des amis dans Classement', !(await p1.$('#view-ranks #f-code')));
  await shot(p1, '2e-classement-amis');
  await p1.click('#r-friends');
  await p1.waitForSelector('#view-profile.active #friends', { timeout: 5000 });
  check('bouton « Gérer mes amis » → Profil', true);
  // Demande envoyée par le téléphone 1 : en attente, sans pseudo, puis annulée
  const zoe = await botPlayer('Zoe');
  const { data: zoeCode } = await zoe.sb.rpc('my_friend_code');
  await p1.fill('#f-code', zoeCode.toLowerCase());
  await p1.click('#f-add button');
  await p1.waitForSelector('#friends [data-fact="cancel"]', { timeout: 15000 });
  const pendingRow = (await p1.textContent('#friends .fr:has([data-fact="cancel"])')).replace(/\s+/g, ' ');
  check('demande envoyée : en attente, sans pseudo', pendingRow.includes('en attente') && !pendingRow.includes(zoe.pseudo), pendingRow);
  // Zoe refuse : le téléphone 1 voit « refusée » et l'heure de relance
  const { data: zoeList } = await zoe.sb.rpc('my_friends');
  await zoe.sb.rpc('respond_friend', { p_user: zoeList[0].user_id, p_accept: false });
  await p1.click('[data-view="cards"]');
  await p1.waitForTimeout(10500);
  await p1.click('[data-view="profile"]');
  await p1.waitForFunction(() => /relance possible dans 48 h/.test((document.querySelector('#friends') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const refused = (await p1.textContent('#friends')).replace(/\s+/g, ' ');
  check('refus affiché avec relance dans 48 h', /refusée · relance possible dans 48 h/.test(refused), refused.slice(0, 300));
  check('pas de bouton avant 48 h', !(await p1.$('#friends [data-fact="retry"]')));
  await shot(p1, '2f-amis');
  for (const P of [bob, eve, zoe]) await admin.auth.admin.deleteUser(P.id);

  // ---------- Téléphone 2 : récupération
  const p2 = await phone('tél2');
  await login(p2);
  await waitSynced(p2);
  await p2.waitForTimeout(500);
  const after2 = await cardsSub(p2);
  check('cartes récupérées sur le 2e téléphone', after2 === before, `${after2}`);
  const bg = await p2.$eval('#cards-content .card .card-img', (el) => el.style.backgroundImage);
  check('photo récupérée', /blob:/.test(bg));
  await shot(p2, '3-cartes-tel2');
  const pts = await p2.textContent('#cards-content .card .card-pts');
  check('points recalculés à l\'identique (lieu inclus)', pts === pts1, `${pts} / ${pts1}`);

  // ---------- Suppression sur le 2, propagation au 1
  await p2.click('#cards-content .card');
  await p2.waitForSelector('#detail:not(.hidden)');
  await p2.click('#detail-del');
  await p2.waitForTimeout(300);
  await p2.click('[data-view="profile"]');
  await waitSynced(p2);
  await p1.click('[data-view="profile"]');
  await p1.click('#a-sync');
  await waitSynced(p1);
  const after1 = await cardsSub(p1);
  check('suppression propagée au 1er téléphone', /^0 cartes.*1 refusées/.test(after1), after1);

  // ---------- Déconnexion puis suppression du compte
  await p1.click('[data-view="profile"]');
  await p1.click('#a-logout');
  await p1.waitForSelector('#a-email', { timeout: 15000 });
  const afterLogout = await cardsSub(p1);
  check('déconnexion : cartes du compte retirées du téléphone', /^0 cartes.*0 refusées/.test(afterLogout), afterLogout);

  await p2.click('[data-view="profile"]');
  await p2.click('#a-delete');
  await p2.waitForSelector('#a-email', { timeout: 20000 });
  check('compte supprimé', await p2.isVisible('#a-email'));

  console.log('erreurs :', errs);
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  await b.close();
  process.exit(failures || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
