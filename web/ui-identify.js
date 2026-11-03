// Fiche « Quel avion as-tu capturé ? » : le joueur choisit le type (en attendant l'IA).
import { AIRCRAFT, CATEGORIES, RARITIES } from './catalog.js';
import { $, closeSheet, esc, openSheet, photoUrl } from './ui-common.js';

let resolver = null;
let ownedTypes = new Set();

/** Ouvre la fiche et renvoie { typeId, registration } (typeId = 'inconnu' si le joueur ne sait pas). */
export function identify(capture, owned) {
  ownedTypes = owned;
  $('identify-photo').src = photoUrl(capture);
  $('identify-search').value = '';
  $('identify-reg').value = capture.registration || '';
  renderList('');
  openSheet('identify');
  return new Promise((resolve) => { resolver = resolve; });
}

function finish(typeId) {
  closeSheet('identify');
  const r = resolver;
  resolver = null;
  if (r) r({ typeId, registration: $('identify-reg').value.trim().toUpperCase() || null });
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
      html += `<button class="type-row" data-type="${a.id}">
        <span>${esc(a.name)}${ownedTypes.has(a.id) ? '<span class="owned">✓ déjà dans ta flotte</span>' : ''}<small>${esc(a.maker)}</small></span>
        <span class="rar" style="background:${r.color}">${r.label} · ${r.points}</span>
      </button>`;
    }
  }
  box.innerHTML = html;
}

export function initIdentify() {
  $('identify-search').addEventListener('input', (e) => renderList(e.target.value));
  $('identify-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-type]');
    if (row) finish(row.dataset.type);
  });
  $('identify-unknown').addEventListener('click', () => finish('inconnu'));
  document.querySelector('[data-close="identify"]').addEventListener('click', () => finish('inconnu'));
}
