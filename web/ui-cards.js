// Écran « Mes cartes » : cartes, album (complétion du catalogue) et photos refusées.
import { AIRCRAFT, CATEGORIES, RARITIES, getType } from './catalog.js';
import { $, cardHtml, esc, fmtDate, photoUrl, placeLong, rarityStyle, toast } from './ui-common.js';
import { breakdownHtml } from './ui-reveal.js';

let filter = 'cards';
let ctx = null; // { getList, onChangeType, onDelete }

export function initCards(context) {
  ctx = context;
  $('cards-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    for (const c of document.querySelectorAll('#cards-filter .chip')) c.classList.toggle('active', c === chip);
    renderCards();
  });
  $('cards-content').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (card) return openDetail(card.dataset.id);
    const locked = e.target.closest('[data-locked]');
    if (locked) {
      const t = getType(locked.dataset.locked);
      const r = RARITIES[t.rarity];
      toast(`${t.name} : ${r.label}, ${r.points} pts. Pas encore capturé !`);
    }
  });
  document.querySelector('[data-close="detail"]').addEventListener('click', () => $('detail').classList.add('hidden'));
}

export function renderCards() {
  const list = ctx.getList();
  const valid = list.filter((c) => c.valid);
  const owned = new Set(valid.map((c) => c.typeId).filter((id) => id && id !== 'inconnu'));
  $('cards-sub').textContent = `${valid.length} cartes · ${owned.size}/${AIRCRAFT.length} types · ${list.length - valid.length} refusées`;
  const box = $('cards-content');

  if (filter === 'cards') {
    box.innerHTML = valid.length
      ? `<div class="grid">${valid.map((c) => cardHtml(c)).join('')}</div>`
      : '<p class="empty">Aucune carte pour l’instant. Va chasser ton premier avion !</p>';
    return;
  }

  if (filter === 'refused') {
    const refused = list.filter((c) => !c.valid);
    box.innerHTML = refused.length
      ? `<ul class="refused-list">${refused.map((c) => `
          <li data-id="${esc(c.id)}"><img src="${photoUrl(c)}" alt="" />
            <div class="info"><b>${esc(fmtDate(c.takenAt, true))}</b>
              <div>Confiance ${Math.round(c.confidence * 100)} % · taille ${Math.round(c.sizeRatio * 100)} % · netteté ${Math.round(c.sharpness)}</div>
              <div class="reason">${esc(c.reasons.join(' · '))}</div></div></li>`).join('')}</ul>`
      : '<p class="empty">Aucune photo refusée.</p>';
    return;
  }

  // Album : le catalogue complet, par catégorie, avec la meilleure carte de chaque type.
  const bestByType = {};
  for (const c of valid) {
    if (!c.typeId || c.typeId === 'inconnu') continue;
    if (!bestByType[c.typeId] || c.points > bestByType[c.typeId].points) bestByType[c.typeId] = c;
  }
  const pct = Math.round((owned.size / AIRCRAFT.length) * 100);
  let html = `<div class="progress-wrap"><div class="xp-line" style="margin:4px 0"><span>Album complété</span><span>${pct} %</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  for (const [cat, label] of Object.entries(CATEGORIES)) {
    const items = AIRCRAFT.filter((a) => a.category === cat);
    const got = items.filter((a) => bestByType[a.id]).length;
    html += `<div class="album-group"><h3>${esc(label)} <span>${got}/${items.length}</span></h3><div class="grid">`;
    for (const a of items) {
      const c = bestByType[a.id];
      if (c) html += cardHtml(c, { showPoints: false });
      else html += `<button class="card locked" style="${rarityStyle(a.rarity)}" data-locked="${a.id}">
          <div class="card-img"></div><span class="card-rarity">${RARITIES[a.rarity].label}</span>
          <div class="card-body"><div class="card-name">${esc(a.name)}</div><div class="card-maker">${esc(a.maker)}</div></div></button>`;
    }
    html += '</div></div>';
  }
  box.innerHTML = html + '<div style="height:30px"></div>';
}

export function openDetail(id) {
  const c = ctx.getList().find((x) => x.id === id);
  if (!c) return;
  const t = getType(c.typeId);
  const r = RARITIES[t.rarity];
  $('detail-title').textContent = c.valid ? t.name : 'Photo refusée';
  $('detail-body').innerHTML = `
    <img class="big" src="${photoUrl(c)}" alt="" />
    <dl class="kv">
      ${c.valid ? `<dt>Rareté</dt><dd><span class="rar" style="background:${r.color}">${t.id === 'inconnu' ? 'Mystère' : r.label}</span></dd>
      <dt>Constructeur</dt><dd>${esc(t.maker)}</dd>` : ''}
      ${c.registration ? `<dt>Immatriculation</dt><dd>${esc(c.registration)}${c.registrationSource === 'ocr' ? ' <small style="color:var(--ok)">lue sur la photo</small>' : ''}</dd>` : ''}
      ${c.registryModel ? `<dt>Modèle exact</dt><dd>${esc(c.registryModel)} <small style="color:var(--muted)">(registre TC)</small></dd>` : ''}
      <dt>Date</dt><dd>${esc(fmtDate(c.takenAt, true))}</dd>
      <dt>Lieu</dt><dd>${esc(placeLong(c))}</dd>
      <dt>Mesures</dt><dd>Confiance ${Math.round(c.confidence * 100)} % · taille ${Math.round(c.sizeRatio * 100)} % · netteté ${Math.round(c.sharpness)}</dd>
      ${!c.valid ? `<dt>Raisons</dt><dd class="reason">${esc(c.reasons.join(' · '))}</dd>` : ''}
    </dl>
    ${c.valid ? breakdownHtml(c) : ''}
    <div class="actions">
      ${c.valid ? `<button id="detail-type">${t.id === 'inconnu' ? 'Identifier l’avion' : 'Changer le type'}</button>` : ''}
      <button id="detail-share">Partager</button>
      <button id="detail-del" class="danger">Supprimer</button>
    </div>`;
  $('detail').classList.remove('hidden');

  const typeBtn = $('detail-type');
  if (typeBtn) typeBtn.onclick = async () => { $('detail').classList.add('hidden'); await ctx.onChangeType(c.id); };
  $('detail-del').onclick = async () => {
    if (!confirm('Supprimer cette capture ?')) return;
    $('detail').classList.add('hidden');
    await ctx.onDelete(c.id);
  };
  $('detail-share').onclick = async () => {
    const text = `SkyHunt : ${c.valid ? `${t.name} (${r.label}) · ${c.points} pts` : 'photo refusée'} · ${placeLong(c)}`;
    try {
      const file = new File([c.photo], `skyhunt-${c.id}.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text });
      else if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Texte copié'); }
    } catch { /* partage annulé */ }
  };
}
