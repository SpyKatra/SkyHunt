const { chromium } = require('playwright');
const fs = require('fs'); fs.mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true });
const URL_APP = process.env.SKYHUNT_URL || 'http://localhost:8766/';
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + require('path').join(__dirname, 'cam.y4m') + ''] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'geolocation'], geolocation: { latitude: 46.7956, longitude: -71.3821, accuracy: 5 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('tile.openstreetmap')) errs.push(m.text()); });
  p.on('dialog', (d) => d.accept());
  await p.goto(URL_APP);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's0-start.png') });
  await p.click('#start');
  // consigne de sécurité au premier lancement
  await p.waitForSelector('#notice:not(.hidden)', { timeout: 5000 });
  console.log('sécurité:', (await p.textContent('#notice-title')).trim());
  await p.waitForTimeout(400);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's0b-securite.png') });
  await p.click('#notice-ok');

  // 1) avion loin -> refusée
  await p.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Trop loin'), null, { timeout: 15000 });
  await p.click('#shutter');
  await p.waitForTimeout(600);

  // 2) avion proche -> identification -> révélation
  await p.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Avion identifiable'), null, { timeout: 15000 });
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's1-camera.png') });
  await p.click('#shutter');
  await p.waitForSelector('#identify:not(.hidden)', { timeout: 5000 });
  await p.waitForSelector('#auto-confirm', { timeout: 30000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's2-identify.png') });
  console.log('auto:', (await p.textContent('#identify-auto')).replace(/\s+/g, ' ').trim(), '| reg field:', await p.inputValue('#identify-reg'));
  await p.click('#auto-confirm');
  await p.waitForSelector('#reveal:not(.hidden)');
  await p.waitForTimeout(1600);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's3-reveal.png') });
  console.log('reveal:', (await p.textContent('#reveal-details')).replace(/\s+/g, ' ').trim());
  await p.click('#reveal-ok');

  // 3) seconde capture valide -> avion mystère
  await p.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Avion identifiable'), null, { timeout: 15000 });
  await p.click('#shutter');
  await p.waitForSelector('#identify:not(.hidden)');
  await p.waitForFunction(() => !document.querySelector('#identify-auto').textContent.includes('Lecture'), null, { timeout: 30000 });
  console.log('auto2:', (await p.textContent('#identify-auto')).replace(/\s+/g, ' ').trim());
  // type militaire : avertissement ; « Annuler » laisse la fiche ouverte
  await p.click('#identify-list [data-type="f18"]');
  await p.waitForSelector('#notice:not(.hidden)', { timeout: 5000 });
  console.log('militaire:', (await p.textContent('#notice-title')).trim());
  await p.waitForTimeout(400);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's3b-militaire.png') });
  await p.click('#notice-cancel');
  if (await p.isHidden('#identify')) throw new Error('la fiche devait rester ouverte après « Annuler »');
  await p.click('#identify-unknown');
  await p.waitForSelector('#reveal:not(.hidden)');
  await p.waitForTimeout(1500);
  console.log('reveal2:', (await p.textContent('#reveal-details')).replace(/\s+/g, ' ').trim());
  await p.click('#reveal-ok');

  // 4) avion photographié sur un écran -> refusé (anti-triche, web/screen.js)
  await p.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Photo d’écran'), null, { timeout: 20000 });
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's3b-ecran.png') });
  await p.click('#shutter');
  await p.waitForTimeout(600);
  console.log('écran:', await p.textContent('#toast').catch(() => '?'));

  // Cartes
  await p.click('[data-view="cards"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's4-cards.png') });
  console.log('cards:', await p.textContent('#cards-sub'));
  await p.click('[data-filter="album"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's5-album.png') });
  await p.click('[data-filter="cards"]');
  await p.click('#cards-content .card');
  await p.waitForTimeout(400);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's6-detail.png') });
  await p.click('[data-close="detail"]');
  await p.click('[data-filter="refused"]');
  await p.waitForTimeout(300);
  console.log('refused items:', await p.locator('.refused-list li').count());

  // Carte du monde
  await p.click('[data-view="map"]');
  await p.waitForTimeout(800);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's7-map.png') });
  console.log('map:', (await p.textContent('#map-info')).replace(/\s+/g, ' ').trim(), '| markers:', await p.locator('.leaflet-interactive').count());

  // Profil
  await p.click('[data-view="profile"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's8-profile.png') });
  console.log('profile:', (await p.textContent('.profile-hero')).replace(/\s+/g, ' ').trim());
  await p.evaluate(() => document.querySelector('#view-profile').scrollTo(0, 600));
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 's9-profile2.png') });

  console.log('errors:', errs);
  await b.close();
})();
