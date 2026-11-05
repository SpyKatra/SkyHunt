// Fiche « Quel avion as-tu capturé ? »
// 1. L'immatriculation est lue automatiquement sur la photo (OCR sur le téléphone).
// 2. Si c'est une marque canadienne (C-) ou américaine (N), le registre de Transport Canada ou de la FAA
//    donne le modèle exact.
// 3. Le joueur confirme d'une touche, ou choisit lui-même dans le catalogue.
import { AIRCRAFT, CATEGORIES, RARITIES, getType } from './catalog.js';
import { readRegistration } from './ocr.js';
import { REGISTRY_NAMES, lookupRegistration, normalizeRegistration, notFoundMessage } from './registry.js';
import { cloudState } from './cloud.js';
import { MILITARY_FORBIDDEN_TEXT, MILITARY_WARNING, acceptMilitary, militaryGate } from './military.js';
import { $, askNotice, closeSheet, esc, openSheet, photoUrl } from './ui-common.js';

let resolver = null;
let ownedTypes = new Set();
let session = 0;       // ignore les résultats d'une fiche précédente
let auto = null;       // { registration, source, lookup }
let regTouched = false;
let current = null;    // capture en cours d'identification

/** Pays du joueur : celui du profil, sinon la région de la langue du navigateur (fr-CA → CA). */
function playerCountry() {
  const p = cloudState().profile;
  if (p && p.country) return p.country;
  const m = /-([A-Z]{2})$/i.exec(navigator.language || '');
  return m ? m[1].toUpperCase() : null;
}

/**
 * Ouvre la fiche et renvoie { typeId, registration, registrationSource, registryModel, militaryAckAt }.
 * typeId = 'inconnu' si le joueur ne sait pas. Un appareil militaire demande d'abord d'accepter l'avertissement.
 */
export function identify(capture, owned, { autoRead = true } = {}) {
  ownedTypes = owned;
  current = capture;
  const my = ++session;
  auto = null;
  regTouched = false;
  $('identify-photo').src = photoUrl(capture);
  $('identify-search').value = '';
  $('identify-reg').value = capture.registration || '';
  renderList('');
  openSheet('identify');

  if (capture.registration) {
    showLookup(capture.registration, capture.registrationSource || 'manuel', my);
  } else if (autoRead && capture.photo) {
    setAuto('<span class="spinner"></span>Lecture de l’immatriculation…', '');
    readRegistration(capture.photo, capture.box || null)
      .then((r) => {
        if (my !== session) return;
        if (!r.registration) {
          setAuto('Aucune immatriculation lisible sur la photo. Choisis le type ci-dessous ou tape l’immatriculation.', '');
          return;
        }
        if (!regTouched) $('identify-reg').value = r.registration;
        showLookup(r.registration, 'ocr', my);
      })
      .catch(() => {
        if (my === session) setAuto('Lecture automatique indisponible. Choisis le type ci-dessous.', '');
      });
  } else {
    setAuto('', '');
  }
  return new Promise((resolve) => { resolver = resolve; });
}

function setAuto(html, cls) {
  const el = $('identify-auto');
  el.className = `auto ${cls}`;
  el.classList.toggle('hidden', !html);
  el.innerHTML = html;
}

async function showLookup(reg, source, my) {
  const norm = normalizeRegistration(reg);
  const lookup = await lookupRegistration(norm);
  if (my !== session) return;
  auto = { registration: norm, source, lookup };
  const srcLabel = source === 'ocr' ? 'Lue automatiquement sur la photo' : 'Saisie manuelle';

  if (lookup && lookup.typeId) {
    const t = getType(lookup.typeId);
    const r = RARITIES[t.rarity];
    setAuto(`<div class="reg">${esc(norm)}</div>
      <div class="model">${esc(lookup.label)}</div>
      <div class="src">${srcLabel} · ${REGISTRY_NAMES[lookup.registry]} du ${esc(lookup.date)}</div>
      <button class="confirm" id="auto-confirm">Confirmer : ${esc(t.name)} · ${r.label}</button>`, 'found');
    $('auto-confirm').onclick = () => finish(lookup.typeId);
    markSuggested(lookup.typeId);
  } else if (lookup) {
    setAuto(`<div class="reg">${esc(norm)}</div>
      <div class="model">${esc(lookup.label)}</div>
      <div class="src">${srcLabel} · ${REGISTRY_NAMES[lookup.registry]} · ce modèle n’est pas encore dans le catalogue SkyHunt : choisis le type le plus proche, ou « Je ne sais pas ».</div>`, 'partial');
    markSuggested(null);
  } else {
    setAuto(`<div class="reg">${esc(norm)}</div>
      <div class="src">${srcLabel} · ${notFoundMessage(norm)} Choisis le type ci-dessous.</div>`, 'partial');
    markSuggested(null);
  }
}

function markSuggested(typeId) {
  for (const row of document.querySelectorAll('#identify-list .type-row')) {
    row.classList.toggle('suggested', row.dataset.type === typeId);
  }
}

/** Avertissement militaire : renvoie la date d'acceptation, ou null si le joueur annule ou si c'est interdit. */
async function militaryAck() {
  if (current && current.militaryAckAt) return current.militaryAckAt; // déjà accepté pour cette photo
  const gate = militaryGate(playerCountry());
  if (gate.blocked) {
    await askNotice({ title: '⛔ Appareil militaire', html: `<p>${esc(MILITARY_FORBIDDEN_TEXT)}</p>`, ok: 'Choisir un autre type', cancel: null });
    return null;
  }
  if (!gate.ask) return gate.ackAt;
  const ok = await askNotice({
    title: '⚠ Appareil militaire détecté',
    html: `<p>${esc(MILITARY_WARNING.replace(/^Appareil militaire détecté\. /, ''))}</p>
      <p class="fnote">${gate.policy === 'restreint' ? 'Pays avec restrictions (ou inconnu) : avertissement à accepter à chaque photo.' : 'Accepté une fois pour cette session.'} Ton acceptation est enregistrée avec la date et l’heure. Ta position n’est jamais publique.</p>`,
  });
  return ok ? acceptMilitary() : null;
}

async function finish(typeId) {
  let militaryAckAt = (current && current.militaryAckAt) || null;
  if (getType(typeId).category === 'militaire') {
    militaryAckAt = await militaryAck();
    if (!militaryAckAt) return; // la fiche reste ouverte : autre type ou « Je ne sais pas »
  }
  closeSheet('identify');
  const r = resolver;
  resolver = null;
  session++;
  const typed = normalizeRegistration($('identify-reg').value) || null;
  const fromAuto = auto && typed === auto.registration;
  if (r) {
    r({
      typeId,
      registration: typed,
      registrationSource: typed ? (fromAuto ? auto.source : 'manuel') : null,
      registryModel: fromAuto && auto.lookup ? auto.lookup.label : null,
      militaryAckAt,
    });
  }
}

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function renderList(q) {
  const nq = norm(q);
  const matches = AIRCRAFT.filter((a) => !nq || norm(`${a.name} ${a.maker} ${a.id}`).includes(nq));
  const box = $('identify-list');
  if (!matches.length) {
    box.innerHTML = '<p class="empty" style="padding:20px">Aucun type trouvé. Choisis « Je ne sais pas ».</p>';
    return;
  }
  let html = '';
  for (const [cat, label] of Object.entries(CATEGORIES)) {
    const items = matches.filter((a) => a.category === cat);
    if (!items.length) continue;
    html += `<h4>${esc(label)}</h4>`;
    for (const a of items) {
      const r = RARITIES[a.rarity];
      const sugg = auto && auto.lookup && auto.lookup.typeId === a.id ? ' suggested' : '';
      html += `<button class="type-row${sugg}" data-type="${a.id}">
        <span>${esc(a.name)}${ownedTypes.has(a.id) ? '<span class="owned">✓ déjà dans ta flotte</span>' : ''}<small>${esc(a.maker)}</small></span>
        <span class="rar" style="background:${r.color}">${r.label} · ${r.points}</span>
      </button>`;
    }
  }
  box.innerHTML = html;
}

let regTimer;
export function initIdentify() {
  $('identify-search').addEventListener('input', (e) => renderList(e.target.value));
  $('identify-reg').addEventListener('input', (e) => {
    regTouched = true;
    clearTimeout(regTimer);
    const v = e.target.value;
    const my = session;
    regTimer = setTimeout(() => {
      if (normalizeRegistration(v).length >= 5) showLookup(v, 'manuel', my);
    }, 350);
  });
  $('identify-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-type]');
    if (row) finish(row.dataset.type);
  });
  $('identify-unknown').addEventListener('click', () => finish('inconnu'));
  document.querySelector('[data-close="identify"]').addEventListener('click', () => finish('inconnu'));
}
