// Petits utilitaires d'interface partagés.
import { RARITIES, cardName, getType, nearestAirport } from './catalog.js';

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Une URL par photo, réutilisée entre les écrans.
const urls = new Map();
export function photoUrl(c) {
  if (!c || !c.photo) return '';
  let u = urls.get(c.id);
  if (!u) {
    u = URL.createObjectURL(c.photo);
    urls.set(c.id, u);
  }
  return u;
}
export function forgetPhoto(id) {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
}

export function placeLabel(c) {
  const ap = nearestAirport(c.latitude, c.longitude);
  if (ap) return ap.code;
  if (c.latitude == null) return 'Lieu inconnu';
  return `${c.latitude.toFixed(2)}, ${c.longitude.toFixed(2)}`;
}
export function placeLong(c) {
  const ap = nearestAirport(c.latitude, c.longitude);
  const coords = c.latitude != null ? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)} (±${Math.round(c.accuracy || 0)} m)` : 'Position inconnue';
  return ap ? `${ap.name} (${ap.code}) · ${coords}` : coords;
}

export function fmtDate(iso, withTime = false) {
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

export function rarityStyle(key) {
  const r = RARITIES[key];
  return `--c:${r.color};--g:${r.glow}`;
}

/** Carte de collection (HTML). */
export function cardHtml(c, { showPoints = true } = {}) {
  const t = getType(c.typeId);
  const r = RARITIES[t.rarity];
  return `
    <button class="card r-${t.rarity}" style="${rarityStyle(t.rarity)}" data-id="${esc(c.id)}">
      <div class="card-img" style="background-image:url('${photoUrl(c)}')"></div>
      <span class="card-rarity">${esc(t.id === 'inconnu' ? 'Mystère' : r.label)}</span>
      ${showPoints ? `<span class="card-pts">${c.points} pts</span>` : ''}
      <div class="card-body">
        <div class="card-name">${esc(cardName(c))}</div>
        <div class="card-maker">${esc(t.maker)}${c.registration ? ` · ${esc(c.registration)}` : ''}</div>
        <div class="card-foot"><span>${esc(placeLabel(c))}</span><span>${esc(fmtDate(c.takenAt))}</span></div>
      </div>
    </button>`;
}

let toastTimer;
export function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

export function openSheet(id) { $(id).classList.remove('hidden'); }
export function closeSheet(id) { $(id).classList.add('hidden'); }

/**
 * Fenêtre d'avertissement bloquante. Renvoie true si le joueur accepte, false s'il annule
 * (sans « cancel », un seul bouton).
 */
export function askNotice({ title, html, ok = 'Je comprends, continuer', cancel = 'Annuler' }) {
  $('notice-title').textContent = title;
  $('notice-body').innerHTML = html;
  $('notice-ok').textContent = ok;
  $('notice-cancel').textContent = cancel || '';
  $('notice-cancel').classList.toggle('hidden', !cancel);
  $('notice').classList.remove('hidden');
  return new Promise((resolve) => {
    const done = (v) => {
      $('notice').classList.add('hidden');
      $('notice-ok').onclick = null;
      $('notice-cancel').onclick = null;
      resolve(v);
    };
    $('notice-ok').onclick = () => done(true);
    $('notice-cancel').onclick = () => done(false);
  });
}
