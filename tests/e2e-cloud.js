// Test de bout en bout du compte et de la sauvegarde (instance Supabase locale).
//   npx supabase start                       (racine du dépôt, Docker requis)
//   cd web && python3 -m http.server 8766    (terminal 1)
//   node tests/e2e-cloud.js                  (terminal 2)
// Scénario : téléphone 1 joue sans compte (1 refusée + 1 valide), crée un compte avec le code reçu,
// ses cartes partent sur le serveur ; téléphone 2 se connecte et les récupère (avec la photo) ;
// une suppression sur le téléphone 2 se propage au 1 ; déconnexion ; suppression du compte.
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const URL_APP = process.env.SKYHUNT_URL || 'http://localhost:8766/';
const shot = (p, name) => p.screenshot({ path: path.join(__dirname, 'shots', `c-${name}.png`) });

function localEnv() {
  const out = execSync('npx --yes supabase@3.0.0 status -o json', { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const s = JSON.parse(out.slice(out.indexOf('{')));
  return { url: s.API_URL, key: s.PUBLISHABLE_KEY || s.ANON_KEY, mail: s.MAILPIT_URL || s.INBUCKET_URL };
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
  check('points recalculés à l\'identique', pts === '12 pts', pts);

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
