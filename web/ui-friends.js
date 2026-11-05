// Section « Amis » du Profil : code ami (fixe), demandes reçues à accepter ou refuser,
// demandes envoyées, liste d'amis (supabase/migrations/20261105120000_amis.sql).
// Le classement entre amis est dans l'écran Classement (web/ui-ranks.js).
import {
  cloudState, fetchFriends, formatFriendCode, myFriendCode, removeFriend, requestFriend, respondFriend,
} from './cloud.js';
import { $, esc, toast } from './ui-common.js';

let friends = { list: null, code: null, at: 0, loading: null, error: null };
let typed = ''; // code en cours de saisie, gardé entre deux rendus
const listeners = [];
/** fn(rankChanged) : appelé quand la liste change (rankChanged = le classement entre amis a changé). */
export const onFriendsChange = (fn) => { listeners.push(fn); };
const emit = (rankChanged = false) => { for (const fn of listeners) fn(rankChanged); };

export const incomingCount = () => (friends.list || []).filter((f) => f.state === 'reçue').length;
const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : '');

/** maxAge : âge maximal de la liste gardée en mémoire (ms). */
export function loadFriends(force = false, rankChanged = false, maxAge = 60000) {
  const cs = cloudState();
  if (!cs.enabled || !cs.user || !cs.profile) {
    if (friends.list || friends.code) { friends = { list: null, code: null, at: 0, loading: null, error: null }; updateBadge(); emit(); }
    return Promise.resolve();
  }
  if (friends.loading) return friends.loading;
  if (!force && friends.list && Date.now() - friends.at < maxAge) return Promise.resolve();
  friends.loading = Promise.all([fetchFriends(), friends.code ? friends.code : myFriendCode()])
    .then(([list, code]) => { friends.list = list; friends.code = code; friends.error = null; friends.at = Date.now(); })
    .catch((e) => { friends.error = e.message; })
    .finally(() => { friends.loading = null; updateBadge(); emit(rankChanged); });
  return friends.loading;
}

/** Pastille sur l'onglet Profil : nombre de demandes reçues. */
function updateBadge() {
  const n = incomingCount();
  const tab = document.querySelector('.tab[data-view="profile"]');
  if (!tab) return;
  let b = tab.querySelector('.badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'badge'; tab.appendChild(b); }
  b.textContent = String(n);
}

const hoursLeft = (iso) => Math.max(1, Math.ceil((new Date(iso) - Date.now()) / 3600000));

/** HTML de la section (vide sans compte). */
export function friendsHtml() {
  const cs = cloudState();
  if (!cs.enabled || !cs.user || !cs.profile) return '';
  if (friends.list == null) {
    if (!friends.loading) loadFriends();
    return `<div class="section friends" id="friends"><h2>Amis</h2>
      <p class="muted">${friends.error ? `Amis indisponibles : ${esc(friends.error)}. <button class="link" data-fact="reload">Réessayer</button>` : 'Chargement…'}</p></div>`;
  }
  const by = (s) => friends.list.filter((f) => f.state === s);
  const who = (f) => `${flag(f.country)} ${esc(f.pseudo || '?')}`;
  const row = (name, buttons) => `<div class="fr"><span class="fr-name">${name}</span>${buttons}</div>`;
  const incoming = by('reçue').map((f) => row(who(f), `
      <button class="fr-ok" data-fact="accept" data-id="${f.userId}">Accepter</button>
      <button class="fr-no" data-fact="decline" data-id="${f.userId}">Refuser</button>`)).join('');
  const outgoing = [
    ...by('envoyée').map((f) => row(`Code ${esc(formatFriendCode(f.code))} <em>en attente</em>`,
      `<button class="fr-no" data-fact="cancel" data-id="${f.userId}">Annuler</button>`)),
    ...by('refusée').map((f) => {
      const ready = new Date(f.retryAt) <= new Date();
      return row(`Code ${esc(formatFriendCode(f.code))} <em>refusée${ready ? '' : ` · relance possible dans ${hoursLeft(f.retryAt)} h`}</em>`,
        ready ? `<button class="fr-ok" data-fact="retry" data-code="${esc(f.code)}">Relancer</button>
                 <button class="fr-no" data-fact="cancel" data-id="${f.userId}">Retirer</button>` : '');
    }),
  ].join('');
  const mine = by('ami').map((f) => row(who(f), `<button class="fr-no" data-fact="remove" data-id="${f.userId}">Retirer</button>`)).join('');
  return `
    <div class="section friends settings" id="friends">
      <h2>Amis${by('ami').length ? ` (${by('ami').length})` : ''}</h2>
      ${incoming ? `<h3>Demandes reçues</h3>${incoming}
        <p class="muted fnote">Une personne refusée ne pourra te relancer qu'au bout de 48 h.</p>` : ''}
      <div class="fcode">
        <span class="muted">Mon code ami</span>
        <b>${esc(formatFriendCode(friends.code))}</b>
        <button data-fact="share">${navigator.share ? 'Partager mon code' : 'Copier mon code'}</button>
      </div>
      <form id="f-add" autocomplete="off">
        <label>Ajouter un ami : son code
          <input id="f-code" maxlength="9" value="${esc(typed)}" placeholder="ABCD-EFGH" autocapitalize="characters" spellcheck="false">
        </label>
        <button class="primary-small" type="submit">Envoyer la demande</button>
      </form>
      <p class="muted fnote">Ton ami doit accepter ta demande avant que vous apparaissiez dans le classement l'un de l'autre.
        Ne donne ton code qu'aux personnes que tu connais.</p>
      ${outgoing ? `<h3>Demandes envoyées</h3>${outgoing}` : ''}
      <h3>Mes amis</h3>
      ${mine || '<p class="muted">Pas encore d\'amis. Partage ton code !</p>'}
    </div>`;
}

/** À appeler une fois : écoute les clics dans le conteneur du Profil. */
export function initFriends(container) {
  container.addEventListener('input', (e) => { if (e.target.id === 'f-code') typed = e.target.value; });
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fact]');
    if (!btn) return;
    const act = btn.dataset.fact;
    const id = btn.dataset.id;
    try {
      if (act === 'reload') { await loadFriends(true); return; }
      if (act === 'share') {
        const text = formatFriendCode(friends.code);
        if (navigator.share) {
          try { await navigator.share({ text: `Mon code ami SkyHunt : ${text}` }); return; } catch (err) { if (err.name === 'AbortError') return; }
        }
        await navigator.clipboard.writeText(text);
        toast('Code copié.');
        return;
      }
      btn.disabled = true;
      let rank = false;
      if (act === 'accept') { await respondFriend(id, true); toast('Demande acceptée.'); rank = true; }
      if (act === 'decline') { await respondFriend(id, false); toast('Demande refusée.'); }
      if (act === 'cancel') await removeFriend(id);
      if (act === 'retry') { await send(btn.dataset.code); return; }
      if (act === 'remove') {
        const f = (friends.list || []).find((x) => x.userId === id);
        if (!confirm(`Retirer ${f ? f.pseudo : 'cet ami'} de tes amis ?`)) { btn.disabled = false; return; }
        await removeFriend(id);
        rank = true;
      }
      await loadFriends(true, rank);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
  container.addEventListener('submit', async (e) => {
    if (e.target.id !== 'f-add') return;
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try { if (await send($('f-code').value)) { typed = ''; $('f-code').value = ''; } } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
}

async function send(code) {
  if (!(code || '').trim()) return false;
  const r = await requestFriend(code.trim());
  if (r === 'inconnu') { toast('Code inconnu. Vérifie les 8 caractères.'); return false; }
  toast(r === 'acceptée' ? 'Vous êtes maintenant amis !' : 'Demande envoyée. Elle comptera quand ton ami l\'aura acceptée.');
  await loadFriends(true, r === 'acceptée');
  return true;
}
