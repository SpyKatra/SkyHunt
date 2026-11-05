// Écran « Classement » : mondial, national (pays du compte) et du mois, calculés par le serveur.
import { cloudState, fetchLeaderboard } from './cloud.js';
import { $, esc } from './ui-common.js';

const regionName = (() => {
  try { const dn = new Intl.DisplayNames(['fr'], { type: 'region' }); return (c) => dn.of(c) || c; } catch { return (c) => c; }
})();
/** Drapeau à partir du code ISO (lettres régionales Unicode). */
export const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : '');
const monthLabel = (d) => d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });

let ctx = null; // { onGoProfile }
let scope = 'monde';
let cache = {};       // clé → { rows, at }
let loading = null;

export function initRanks(context) {
  ctx = context;
  $('view-ranks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]');
    if (b) { scope = b.dataset.scope; renderRanks(); return; }
    if (e.target.closest('#r-login')) ctx.onGoProfile();
    if (e.target.closest('#r-refresh')) { cache = {}; renderRanks(); }
  });
}

function query() {
  const cs = cloudState();
  const country = cs.profile ? cs.profile.country : null;
  const now = new Date();
  const month = now.toISOString().slice(0, 7) + '-01';
  if (scope === 'pays') return { key: `pays:${country}`, args: { country }, title: `${flag(country)} ${regionName(country)}` };
  if (scope === 'mois') return { key: `mois:${month}`, args: { month }, title: `Mois de ${monthLabel(new Date(month))}` };
  return { key: 'monde', args: {}, title: 'Monde' };
}

export function renderRanks() {
  const el = $('ranks-content');
  const cs = cloudState();
  if (!cs.enabled || !cs.user || !cs.profile) {
    el.innerHTML = `
      <div class="section ranks-empty">
        <h2>Classements</h2>
        <p class="muted">Crée un compte (ou connecte-toi) pour comparer tes points avec les autres chasseurs :
          classement mondial, national et du mois.</p>
        <button id="r-login" class="primary-small">Aller au compte</button>
      </div>`;
    return;
  }
  const q = query();
  const tabs = [['monde', 'Monde'], ['pays', `${flag(cs.profile.country)} Pays`], ['mois', 'Ce mois-ci']];
  const hit = cache[q.key];
  const fresh = hit && Date.now() - hit.at < 60000;
  el.innerHTML = `
    <div class="seg">${tabs.map(([k, l]) => `<button data-scope="${k}" class="${k === scope ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="section ranks">
      <h2>${esc(q.title)} <button id="r-refresh" class="link" title="Actualiser">↻</button></h2>
      <div id="r-list">${hit ? listHtml(hit.rows) : '<p class="muted">Chargement…</p>'}</div>
      <p class="foot-note">Points recalculés par le serveur. Lieu : 5 points pour un lieu jamais capturé,
        puis moins à mesure que les chasseurs y passent.${scope === 'mois' ? ' Mois en temps universel (UTC).' : ''}</p>
    </div>`;
  if (!fresh && !loading) {
    const key = q.key;
    loading = fetchLeaderboard(q.args)
      .then((rows) => { cache[key] = { rows, at: Date.now() }; })
      .catch((e) => { cache[key] = { rows: null, error: e.message, at: Date.now() }; })
      .finally(() => { loading = null; if (query().key === key && $('view-ranks').classList.contains('active')) renderRanks(); });
  }
}

function listHtml(rows) {
  if (!rows) return '<p class="muted">Classement indisponible (réseau ?). Touche ↻ pour réessayer.</p>';
  if (!rows.length) return '<p class="muted">Personne n\'a encore marqué de points ici. À toi de jouer !</p>';
  let prev = 0;
  return rows.map((r) => {
    const gap = r.rank > prev + 1 && prev > 0 ? '<div class="rk-gap">…</div>' : '';
    prev = r.rank;
    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}`;
    return `${gap}<div class="rk ${r.isMe ? 'me' : ''}">
      <span class="rk-n">${medal}</span>
      <span class="rk-name">${flag(r.country)} ${esc(r.pseudo)}${r.isMe ? ' <em>(toi)</em>' : ''}</span>
      <span class="rk-cap">${r.captures} carte${r.captures > 1 ? 's' : ''}</span>
      <b class="rk-pts">${r.points}</b>
    </div>`;
  }).join('');
}

/** À appeler quand les points changent (synchro, nouvelle capture) : le classement sera relu. */
export function invalidateRanks() { cache = {}; }
