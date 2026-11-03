import { DEFAULT_THRESHOLDS, DETECTION_INTERVAL_MS, PROTOTYPE_POINTS } from './config.js';
import { createDetector } from './detector.js';
import { addCapture, clearCaptures, deleteCapture, listCaptures } from './store.js';
import { checkDetection } from './validation.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');

const state = {
  detector: null,
  running: false,
  detection: null,
  check: null,
  position: null, // dernière position GPS connue
  busy: false,
  thresholds: loadThresholds(),
};

/* ---------- Seuils réglables ---------- */
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

/* ---------- Démarrage ---------- */
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

/* ---------- Boucle d'analyse ---------- */
async function loop() {
  if (!state.running) return;
  const t0 = performance.now();
  if (video.readyState >= 2 && !document.hidden) {
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

  // Diagnostic
  const set = (id, text, fail) => { const el = $(id); el.textContent = text; el.classList.toggle('fail', fail); };
  set('d-conf', `${Math.round(d.confidence * 100)} % (min ${Math.round(t.minConfidence * 100)})`, d.confidence < t.minConfidence);
  set('d-size', `${Math.round(d.sizeRatio * 100)} % (min ${Math.round(t.minSizeRatio * 100)})`, d.found && d.sizeRatio < t.minSizeRatio);
  set('d-sharp', `${Math.round(d.sharpness)} (min ${t.minSharpness})`, d.found && d.sharpness < t.minSharpness);
  set('d-bright', `${Math.round(d.brightness)}`, d.found && (d.brightness < t.minBrightness || d.brightness > t.maxBrightness));
  set('d-ms', `${Math.round(d.inferenceMs)} ms`, false);

  drawBox(d, c);
}

/** Dessine le cadre en tenant compte du recadrage « object-fit: cover » de la vidéo. */
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
  octx.strokeRect(x, y, w, h);
  const label = `Avion ${Math.round(d.confidence * 100)} %`;
  octx.font = '700 13px -apple-system, sans-serif';
  const tw = octx.measureText(label).width + 12;
  octx.fillStyle = color;
  octx.fillRect(x - 1.5, Math.max(0, y - 22), tw, 20);
  octx.fillStyle = '#000';
  octx.fillText(label, x + 5, Math.max(14, y - 7));
}

/* ---------- Capture ---------- */
$('shutter').addEventListener('click', capture);

async function capture() {
  if (state.busy || !state.running) return;
  state.busy = true;
  const shutter = $('shutter');
  shutter.classList.add('busy');

  // Verdict figé au moment du déclenchement.
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

    await addCapture({
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
      thresholds: { ...state.thresholds },
      valid,
      reasons,
      points: valid ? PROTOTYPE_POINTS : 0,
      userAgent: navigator.userAgent,
    });
    toast(valid ? `+${PROTOTYPE_POINTS} points !` : 'Ajoutée au carnet, 0 point');
    refreshTabCount();
  } catch (e) {
    toast(`Erreur : ${e.message || e}`);
  } finally {
    state.busy = false;
    shutter.classList.remove('busy');
  }
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

/* ---------- Diagnostic ---------- */
$('toggle-debug').addEventListener('click', () => {
  const el = $('debug');
  el.classList.toggle('hidden');
  $('toggle-debug').textContent = el.classList.contains('hidden') ? 'Diagnostic' : 'Masquer diag.';
});

/* ---------- Onglets ---------- */
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showView(tab.dataset.view));
}
function showView(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === name);
  $('view-camera').classList.toggle('active', name === 'camera');
  $('view-collection').classList.toggle('active', name === 'collection');
  if (name === 'collection') renderCollection();
}

/* ---------- Collection ---------- */
let objectUrls = [];

async function refreshTabCount() {
  const list = await listCaptures();
  const total = list.reduce((s, c) => s + c.points, 0);
  $('tab-coll').textContent = `Collection (${list.length}) · ${total} pts`;
  return list;
}

async function renderCollection() {
  const list = await refreshTabCount();
  const valid = list.filter((c) => c.valid).length;
  const total = list.reduce((s, c) => s + c.points, 0);
  $('coll-sub').textContent = `${total} points · ${valid} validées · ${list.length - valid} refusées`;

  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  const ul = $('coll-list');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li class="empty">Aucune capture pour l’instant. Va photographier un avion !</li>';
    return;
  }
  for (const c of list) {
    const url = URL.createObjectURL(c.photo);
    objectUrls.push(url);
    const li = document.createElement('li');
    const where = c.latitude != null
      ? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)} (±${Math.round(c.accuracy)} m)`
      : 'Position inconnue';
    li.innerHTML = `
      <img alt="" />
      <div class="info">
        <div class="top"><span class="badge ${c.valid ? 'ok' : 'no'}">${c.valid ? 'Validée' : 'Refusée'}</span>
          <span class="pts">${c.points} pts</span></div>
        <div>${new Date(c.takenAt).toLocaleString('fr-CA')}</div>
        <div>${where}</div>
        <div>Confiance ${Math.round(c.confidence * 100)} % · taille ${Math.round(c.sizeRatio * 100)} % · netteté ${Math.round(c.sharpness)}</div>
        ${c.reasons.length ? `<div class="reason"></div>` : ''}
        <button class="del">Supprimer</button>
      </div>`;
    li.querySelector('img').src = url;
    if (c.reasons.length) li.querySelector('.reason').textContent = c.reasons.join(' · ');
    li.querySelector('.del').addEventListener('click', async () => {
      if (confirm('Supprimer cette capture ?')) {
        await deleteCapture(c.id);
        renderCollection();
      }
    });
    ul.appendChild(li);
  }
}

$('clear-all').addEventListener('click', async () => {
  if (confirm('Effacer toute la collection ?')) {
    await clearCaptures();
    renderCollection();
  }
});

/** Copie les mesures (sans les photos) en CSV, à coller dans un message. */
$('copy-data').addEventListener('click', async () => {
  const list = await listCaptures();
  const head = 'date,valide,points,confiance,taille,nettete,luminosite,precision_gps_m,raisons';
  const rows = list.map((c) => [
    c.takenAt, c.valid ? 'oui' : 'non', c.points, c.confidence.toFixed(2), c.sizeRatio.toFixed(2),
    Math.round(c.sharpness), Math.round(c.brightness), c.accuracy != null ? Math.round(c.accuracy) : '',
    `"${c.reasons.join(' | ')}"`,
  ].join(','));
  const csv = [head, ...rows].join('\n');
  try {
    await navigator.clipboard.writeText(csv);
    alert(`${list.length} mesures copiées. Colle-les dans ta conversation avec Claude.`);
  } catch {
    if (navigator.share) navigator.share({ title: 'Mesures SkyHunt', text: csv }).catch(() => {});
    else alert(csv);
  }
});

refreshTabCount();
