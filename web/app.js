import { DEFAULT_THRESHOLDS, DETECTION_INTERVAL_MS } from './config.js';
import { createDetector } from './detector.js';
import { achievementState, computeStats, levelFor, recomputeAll } from './game.js';
import { addCapture, clearCaptures, deleteCapture, listCaptures } from './store.js';
import { cloudState, initCloud, onCloudChange, queueDelete, scheduleSync, stamp } from './cloud.js';
import { initCards, openDetail, renderCards } from './ui-cards.js';
import { $, forgetPhoto, toast } from './ui-common.js';
import { identify, initIdentify } from './ui-identify.js';
import { warmUpOcr } from './ocr.js';
import { bindMapPopupLinks, initMap, renderMap } from './ui-map.js';
import { initProfile, renderProfile } from './ui-profile.js';
import { reveal } from './ui-reveal.js';
import { checkDetection } from './validation.js';
import { SCREEN_CLASSES } from './screen.js';

const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');

const state = {
  detector: null,
  running: false,
  detection: null,
  check: null,
  position: null,
  busy: false,
  thresholds: loadThresholds(),
  list: [],          // captures avec points recalculés
  view: 'camera',
};

/* =================== Données =================== */
async function reload() {
  const raw = await listCaptures();
  state.list = recomputeAll(raw);
  updateBadges();
  return state.list;
}
const getList = () => state.list;

function updateBadges() {
  const s = computeStats(state.list);
  const lv = levelFor(s.xp);
  $('tab-cards').textContent = s.valid ? `Cartes (${s.valid})` : 'Cartes';
  $('hud-lvl').textContent = `Niv. ${lv.level}`;
  $('hud-xp').style.width = `${Math.round(lv.progress * 100)}%`;
}

function ownedTypes() {
  return new Set(state.list.filter((c) => c.valid && c.typeId && c.typeId !== 'inconnu').map((c) => c.typeId));
}

/** Enregistre un changement et renvoie ce qu'il a débloqué (niveau, succès). */
async function saveAndDiff(record) {
  const before = computeStats(state.list);
  const beforeAch = new Set(achievementState(before).filter((a) => a.unlocked).map((a) => a.id));
  const beforeLv = levelFor(before.xp).level;
  await addCapture(stamp(record));
  await reload();
  scheduleSync();
  const after = computeStats(state.list);
  const lv = levelFor(after.xp);
  return {
    capture: state.list.find((c) => c.id === record.id),
    levelUp: lv.level > beforeLv ? lv : null,
    achievements: achievementState(after).filter((a) => a.unlocked && !beforeAch.has(a.id)),
  };
}

function rawOf(c) {
  // Retire les champs calculés avant d'enregistrer.
  const { points, breakdown, ...raw } = c;
  return raw;
}

/* =================== Seuils réglables =================== */
function loadThresholds() {
  try {
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(localStorage.getItem('skyhunt.thresholds') || '{}') };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}
function saveThresholds() {
  try { localStorage.setItem('skyhunt.thresholds', JSON.stringify(state.thresholds)); } catch { /* mode privé */ }
}
const sliders = [
  ['s-conf', 'o-conf', 'minConfidence', (v) => `${Math.round(v * 100)} %`],
  ['s-size', 'o-size', 'minSizeRatio', (v) => `${Math.round(v * 100)} %`],
  ['s-sharp', 'o-sharp', 'minSharpness', (v) => `${Math.round(v)}`],
];
function syncSliders() {
  for (const [sid, oid, key, fmt] of sliders) {
    $(sid).value = state.thresholds[key];
    $(oid).textContent = fmt(state.thresholds[key]);
  }
}
for (const [sid, oid, key, fmt] of sliders) {
  $(sid).addEventListener('input', (e) => {
    state.thresholds[key] = Number(e.target.value);
    $(oid).textContent = fmt(state.thresholds[key]);
    saveThresholds();
  });
}
$('reset-thresholds').addEventListener('click', () => {
  state.thresholds = { ...DEFAULT_THRESHOLDS };
  saveThresholds();
  syncSliders();
});
syncSliders();

/* =================== Caméra =================== */
$('start').addEventListener('click', start);

async function start() {
  const btn = $('start');
  btn.disabled = true;
  btn.textContent = 'Démarrage…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play();
    setStatus('Chargement du modèle…');
    $('start-wrap').classList.add('hidden');
    state.detector = await createDetector();
    warmUpOcr();
    startGps();
    state.running = true;
    loop();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Réessayer';
    const msg = e && e.name === 'NotAllowedError'
      ? 'Caméra refusée. Autorise-la dans Réglages → Safari → Caméra.'
      : `Erreur : ${e && e.message ? e.message : e}`;
    $('start-wrap').classList.remove('hidden');
    $('start-wrap').querySelector('.hint').textContent = msg;
  }
}

function startGps() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.watchPosition(
    (p) => { state.position = p; },
    () => { state.position = null; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  );
}

async function loop() {
  if (!state.running) return;
  const t0 = performance.now();
  if (state.view === 'camera' && video.readyState >= 2 && !document.hidden) {
    try {
      state.detection = state.detector.detect(video);
    } catch (e) {
      console.error(e);
    }
    state.check = checkDetection(state.detection, state.thresholds);
    render();
  }
  const wait = Math.max(0, DETECTION_INTERVAL_MS - (performance.now() - t0));
  setTimeout(() => requestAnimationFrame(loop), wait);
}

function setStatus(text, ok = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

function render() {
  const d = state.detection;
  const c = state.check;
  const t = state.thresholds;
  setStatus(c.message, c.ok);
  const shutter = $('shutter');
  shutter.disabled = false;
  shutter.classList.toggle('ok', c.ok);

  const set = (id, text, fail) => { const el = $(id); el.textContent = text; el.classList.toggle('fail', fail); };
  set('d-conf', `${Math.round(d.confidence * 100)} % (min ${Math.round(t.minConfidence * 100)})`, d.confidence < t.minConfidence);
  set('d-size', `${Math.round(d.sizeRatio * 100)} % (min ${Math.round(t.minSizeRatio * 100)})`, d.found && d.sizeRatio < t.minSizeRatio);
  set('d-sharp', `${Math.round(d.sharpness)} (min ${t.minSharpness})`, d.found && d.sharpness < t.minSharpness);
  set('d-bright', `${Math.round(d.brightness)}`, d.found && (d.brightness < t.minBrightness || d.brightness > t.maxBrightness));
  set('d-moire', `${Math.round(d.moire || 0)} dB (max ${t.maxMoire})`, d.found && (d.moire || 0) >= t.maxMoire);
  set('d-screen', d.screenObject ? `${SCREEN_CLASSES[d.screenClass] || 'écran'} ${Math.round(d.screenObject * 100)} %` : 'non',
    d.found && (d.screenObject || 0) >= t.maxScreenObject);
  set('d-ms', `${Math.round(d.inferenceMs)} ms`, false);
  drawBox(d, c);
}

/** Cadre sur l'avion, en tenant compte du recadrage « object-fit: cover ». */
function drawBox(d, c) {
  const dpr = window.devicePixelRatio || 1;
  const cw = overlay.clientWidth;
  const ch = overlay.clientHeight;
  if (overlay.width !== Math.round(cw * dpr) || overlay.height !== Math.round(ch * dpr)) {
    overlay.width = Math.round(cw * dpr);
    overlay.height = Math.round(ch * dpr);
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, cw, ch);
  if (!d || !d.found || d.confidence < state.thresholds.minConfidence) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * scale) / 2;
  const oy = (ch - vh * scale) / 2;
  const x = ox + d.box.x * vw * scale;
  const y = oy + d.box.y * vh * scale;
  const w = d.box.w * vw * scale;
  const h = d.box.h * vh * scale;

  const color = c.ok ? '#22c55e' : '#f59e0b';
  octx.lineWidth = 3;
  octx.strokeStyle = color;
  // Coins de visée plutôt qu'un rectangle plein.
  const k = Math.min(28, w / 4, h / 4);
  octx.beginPath();
  for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    octx.moveTo(px + dx * k, py);
    octx.lineTo(px, py);
    octx.lineTo(px, py + dy * k);
  }
  octx.stroke();
  const label = `Avion ${Math.round(d.confidence * 100)} %`;
  octx.font = '700 13px -apple-system, sans-serif';
  const tw = octx.measureText(label).width + 12;
  octx.fillStyle = color;
  octx.fillRect(x, Math.max(0, y - 24), tw, 20);
  octx.fillStyle = '#000';
  octx.fillText(label, x + 6, Math.max(14, y - 9));
}

/* =================== Capture =================== */
$('shutter').addEventListener('click', capture);

async function capture() {
  if (state.busy || !state.running) return;
  state.busy = true;
  const shutter = $('shutter');
  shutter.classList.add('busy');

  const d = state.detection || { confidence: 0, sizeRatio: 0, sharpness: 0, brightness: 0 };
  const verdict = checkDetection(state.detection, state.thresholds);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));

    const pos = state.position;
    const reasons = [...verdict.reasons];
    if (!pos) reasons.push('Position GPS inconnue');
    const valid = verdict.ok && !!pos;

    const record = {
      id: String(Date.now()),
      takenAt: new Date().toISOString(),
      photo: blob,
      width: canvas.width,
      height: canvas.height,
      latitude: pos ? pos.coords.latitude : null,
      longitude: pos ? pos.coords.longitude : null,
      accuracy: pos ? pos.coords.accuracy : null,
      gpsAgeS: pos ? Math.round((Date.now() - pos.timestamp) / 1000) : null,
      confidence: d.confidence,
      sizeRatio: d.sizeRatio,
      sharpness: d.sharpness,
      brightness: d.brightness,
      moire: d.moire ?? null,
      screenObject: d.screenObject ?? null,
      box: d.box || null,
      thresholds: { ...state.thresholds },
      valid,
      reasons,
      typeId: null,
      registration: null,
      userAgent: navigator.userAgent,
    };

    if (!valid) {
      await addCapture(stamp(record));
      await reload();
      scheduleSync();
      toast(`Refusée : ${reasons[0] || 'photo non valide'}`);
      return;
    }

    // Capture valide : on demande le type, puis révélation de la carte.
    const ident = await identify(record, ownedTypes());
    const res = await saveAndDiff({ ...record, ...ident });
    await reveal(res.capture, res);
  } catch (e) {
    toast(`Erreur : ${e.message || e}`);
  } finally {
    state.busy = false;
    shutter.classList.remove('busy');
  }
}

/* =================== Diagnostic =================== */
$('toggle-debug').addEventListener('click', () => {
  const el = $('debug');
  el.classList.toggle('hidden');
  $('toggle-debug').textContent = el.classList.contains('hidden') ? 'Diagnostic' : 'Masquer diag.';
});

/* =================== Actions partagées =================== */
async function changeType(id) {
  const c = state.list.find((x) => x.id === id);
  if (!c) return;
  const ident = await identify(c, ownedTypes());
  const before = c.points;
  await addCapture(stamp({ ...rawOf(c), ...ident }));
  await reload();
  scheduleSync();
  const after = state.list.find((x) => x.id === id);
  toast(`Carte mise à jour : ${after.points} pts (avant ${before})`);
  refreshView();
}

async function removeCapture(id) {
  const c = state.list.find((x) => x.id === id);
  if (c) queueDelete(c);
  await deleteCapture(id);
  forgetPhoto(id);
  await reload();
  refreshView();
}

async function copyData() {
  const head = 'date,valide,type,immatriculation,source_immat,modele_registre,points,confiance,taille,nettete,luminosite,moire_db,ecran,precision_gps_m,raisons';
  const rows = state.list.map((c) => [
    c.takenAt, c.valid ? 'oui' : 'non', c.typeId || '', c.registration || '', c.registrationSource || '', `"${c.registryModel || ''}"`, c.points,
    c.confidence.toFixed(2), c.sizeRatio.toFixed(2), Math.round(c.sharpness), Math.round(c.brightness),
    c.moire != null ? c.moire.toFixed(1) : '', c.screenObject != null ? c.screenObject.toFixed(2) : '',
    c.accuracy != null ? Math.round(c.accuracy) : '', `"${c.reasons.join(' | ')}"`,
  ].join(','));
  const csv = [head, ...rows].join('\n');
  try {
    await navigator.clipboard.writeText(csv);
    alert(`${state.list.length} mesures copiées. Colle-les dans ta conversation avec Claude.`);
  } catch {
    if (navigator.share) navigator.share({ title: 'Mesures SkyHunt', text: csv }).catch(() => {});
    else alert(csv);
  }
}

async function clearAll() {
  const msg = cloudState().user
    ? 'Effacer toute la collection, sur ce téléphone ET sur le serveur ? Cette action est définitive.'
    : 'Effacer toute la collection ? Cette action est définitive.';
  if (!confirm(msg)) return;
  for (const c of state.list) { forgetPhoto(c.id); queueDelete(c); }
  await clearCaptures();
  await reload();
  refreshView();
}

/* =================== Navigation =================== */
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showView(tab.dataset.view));
}
function showView(name) {
  state.view = name;
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === name);
  for (const v of ['camera', 'cards', 'map', 'profile']) $(`view-${v}`).classList.toggle('active', v === name);
  refreshView();
}
function refreshView() {
  if (state.view === 'cards') renderCards();
  else if (state.view === 'map') renderMap();
  else if (state.view === 'profile') renderProfile();
}

initIdentify();
initCards({ getList, onChangeType: changeType, onDelete: removeCapture });
initMap({ getList });
bindMapPopupLinks(openDetail);
initProfile({ getList, onCopy: copyData, onClear: clearAll, onAccountChange: async () => { await reload(); refreshView(); } });
reload();

// Compte et sauvegarde sur le serveur (si configuré dans cloud-config.js).
initCloud().then(async () => { await reload(); refreshView(); scheduleSync(0); }).catch((e) => console.warn('cloud', e));
onCloudChange(() => { if (state.view === 'profile') renderProfile({ soft: true }); });
window.addEventListener('skyhunt:pulled', async () => { await reload(); refreshView(); });
