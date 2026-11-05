// Écran « Profil » : niveau, XP, statistiques, succès et réglages.
import { RARITIES } from './catalog.js';
import { achievementState, computeStats, levelFor } from './game.js';
import { $, esc, toast } from './ui-common.js';
import { friendsHtml } from './ui-friends.js';
import {
  cloudState, deleteAccount, saveRemoteProfile, sendCode, signOut, sync, verifyCode,
} from './cloud.js';

// Pays du classement national (codes ISO 3166-1), affichés en français et triés.
const COUNTRY_CODES = ['CA', 'US', 'FR', 'BE', 'CH', 'LU', 'MC', 'GB', 'IE', 'DE', 'ES', 'IT', 'PT', 'NL', 'AT',
  'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'GR', 'MA', 'DZ', 'TN', 'SN', 'CI', 'CM', 'HT', 'MX', 'BR', 'AR', 'CL',
  'AU', 'NZ', 'JP', 'KR', 'SG', 'AE', 'IN', 'ZA'];
const regionName = (() => {
  try { const dn = new Intl.DisplayNames(['fr'], { type: 'region' }); return (c) => dn.of(c) || c; } catch { return (c) => c; }
})();
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: regionName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
// Anciennes valeurs (prototype 0.3) → codes.
const OLD_NAMES = { Canada: 'CA', France: 'FR', Belgique: 'BE', Suisse: 'CH', 'États-Unis': 'US', 'Royaume-Uni': 'GB' };

export function loadProfile() {
  let p = { name: 'Joueur', country: 'CA' };
  try { p = { ...p, ...JSON.parse(localStorage.getItem('skyhunt.profile') || '{}') }; } catch { /* mode privé */ }
  if (!/^[A-Z]{2}$/.test(p.country)) p.country = OLD_NAMES[p.country] || 'CA';
  // Connecté : le profil du serveur fait foi.
  const cs = cloudState();
  if (cs.user && cs.profile) p = { ...p, name: cs.profile.pseudo, country: cs.profile.country };
  return p;
}
function saveProfile(p) {
  try { localStorage.setItem('skyhunt.profile', JSON.stringify(p)); } catch { /* mode privé */ }
}

let ctx = null; // { getList, onCopy, onClear, onAccountChange }
// Saisies en cours, gardées entre deux rendus (l'écran se redessine quand la synchro avance).
const auth = { email: '', code: '', pseudo: null, country: null, codeSent: false, busy: false };

export function initProfile(context) {
  ctx = context;
}

/* =================== Section « Compte » =================== */
function accountHtml() {
  const cs = cloudState();
  if (!cs.enabled) return '';
  const dis = auth.busy ? 'disabled' : '';
  if (!cs.user) {
    return `
    <div class="section settings account" id="account">
      <h2>Compte</h2>
      <p class="muted">Crée un compte (ou connecte-toi) pour sauvegarder tes cartes et participer aux classements.
        Les cartes déjà sur ce téléphone seront ajoutées à ton compte.</p>
      ${auth.codeSent ? `
        <p>Courriel envoyé à <b>${esc(auth.email)}</b> (regarde aussi les indésirables). Entre le code reçu, ou touche le lien du courriel : il ouvre SkyHunt dans Safari, déjà connecté.</p>
        <label>Code à 6 chiffres<input id="a-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" value="${esc(auth.code)}" /></label>
        <div class="row2">
          <button id="a-verify" class="primary-small" ${dis}>Valider</button>
          <button id="a-back" ${dis}>Changer d'adresse</button>
        </div>` : `
        <label>Courriel<input id="a-email" type="email" autocomplete="email" autocapitalize="off" value="${esc(auth.email)}" /></label>
        <button id="a-send" class="primary-small" ${dis}>Recevoir un code</button>`}
    </div>`;
  }
  if (!cs.profileLoaded) {
    return `<div class="section settings account" id="account"><h2>Compte</h2>
      <p class="muted">${cs.error ? esc(cs.error) : 'Chargement du profil…'}</p>
      <button id="a-logout">Se déconnecter</button></div>`;
  }
  if (!cs.profile) {
    const p = loadProfile();
    return `
    <div class="section settings account" id="account">
      <h2>Créer ton profil</h2>
      <p class="muted">Ton pseudo est visible dans les classements. Le pays sert au classement national.
        <b>Choisis bien : ils ne pourront plus être modifiés ensuite</b> (sauf sur demande au support).</p>
      <label>Pseudo<input id="a-pseudo" maxlength="20" value="${esc(auth.pseudo ?? (p.name === 'Joueur' ? '' : p.name))}" /></label>
      <label>Pays<select id="a-country">${countryOptions(auth.country || p.country)}</select></label>
      <div class="row2">
        <button id="a-create" class="primary-small" ${dis}>Créer mon profil</button>
        <button id="a-logout" ${dis}>Se déconnecter</button>
      </div>
    </div>`;
  }
  const status = cs.syncing ? 'Envoi en cours…'
    : cs.error ? `<span class="err">${esc(cs.error)}</span>`
      : cs.pending ? `${cs.pending} modification${cs.pending > 1 ? 's' : ''} en attente`
        : `À jour${cs.lastSync ? ` (${cs.lastSync.toLocaleTimeString('fr-CA', { timeStyle: 'short' })})` : ''}`;
  return `
    <div class="section settings account" id="account">
      <h2>Compte</h2>
      <div class="kv"><span>Courriel</span><b>${esc(cs.user.email || '')}</b></div>
      <div class="kv"><span>Sauvegarde</span><b id="a-status">${status}</b></div>
      <div class="row2">
        <button id="a-sync" ${cs.syncing ? 'disabled' : ''}>Synchroniser</button>
        <button id="a-logout">Se déconnecter</button>
      </div>
      <button id="a-delete" class="link-danger">Supprimer mon compte</button>
    </div>`;
}

function countryOptions(sel) {
  return COUNTRIES.map((c) => `<option value="${c.code}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

async function busy(fn) {
  auth.busy = true;
  renderProfile();
  try { await fn(); } catch (e) { toast(e.message || String(e)); } finally { auth.busy = false; renderProfile(); }
}

function bindAccount() {
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  const keep = (id, key) => { const el = $(id); if (el) el.addEventListener('input', () => { auth[key] = el.value; }); };
  keep('a-email', 'email');
  keep('a-code', 'code');
  keep('a-pseudo', 'pseudo');
  keep('a-country', 'country');
  on('a-send', () => {
    const email = $('a-email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Adresse courriel invalide.'); return; }
    auth.email = email;
    busy(async () => { await sendCode(email); auth.codeSent = true; });
  });
  on('a-back', () => { auth.codeSent = false; auth.code = ''; renderProfile(); });
  on('a-verify', () => {
    const code = $('a-code').value.replace(/\D/g, '');
    if (code.length < 6) { toast('Entre les 6 chiffres du code.'); return; }
    busy(async () => {
      await verifyCode(auth.email, code);
      auth.codeSent = false;
      auth.code = '';
      await ctx.onAccountChange();
      toast('Connecté !');
    });
  });
  on('a-create', () => {
    const pseudo = $('a-pseudo').value.trim();
    if (pseudo.length < 2) { toast('Pseudo : au moins 2 caractères.'); return; }
    const country = $('a-country').value;
    if (!confirm(`Créer ton profil « ${pseudo} » (${COUNTRIES.find((c) => c.code === country)?.name || country}) ? Le pseudo et le pays ne pourront plus être modifiés.`)) return;
    busy(async () => {
      await saveRemoteProfile({ pseudo, country });
      saveProfile({ ...loadProfile(), name: pseudo, country });
      auth.pseudo = null;
      auth.country = null;
      toast('Profil créé.');
    });
  });
  on('a-sync', () => busy(async () => {
    const r = await sync();
    if (cloudState().error) throw new Error(cloudState().error);
    toast(r.pushed || r.pulled ? `${r.pushed} envoyée(s), ${r.pulled} reçue(s)` : 'Déjà à jour');
  }));
  on('a-logout', () => busy(async () => {
    let r = await signOut();
    if (!r.ok) {
      if (!confirm(`${r.pending} modification(s) n'ont pas pu être envoyées (pas de réseau ?). Se déconnecter quand même et les perdre ?`)) return;
      r = await signOut({ force: true });
    }
    await ctx.onAccountChange();
    toast('Déconnecté. Tes cartes restent sur ton compte.');
  }));
  on('a-delete', () => {
    if (!confirm('Supprimer définitivement ton compte, ton profil, toutes tes captures et leurs photos (sur le serveur et sur ce téléphone) ?')) return;
    if (prompt('Pour confirmer, écris SUPPRIMER') !== 'SUPPRIMER') return;
    busy(async () => {
      await deleteAccount();
      await ctx.onAccountChange();
      toast('Compte supprimé.');
    });
  });
}

/** soft : appel automatique (état du serveur) — ne pas effacer une saisie en cours. */
export function renderProfile({ soft = false } = {}) {
  if (soft) {
    const a = document.activeElement;
    if (a && $('profile-content').contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
  }
  const list = ctx.getList();
  const s = computeStats(list);
  const lv = levelFor(s.xp);
  const p = loadProfile();
  const cs = cloudState();
  const online = cs.user && cs.profile;
  const ach = achievementState(s);
  const unlocked = ach.filter((a) => a.unlocked).length;
  const maxRarity = Math.max(1, ...Object.values(s.byRarity));

  $('profile-content').innerHTML = `
    <div class="profile-hero">
      <div class="avatar" style="--p:${Math.round(lv.progress * 100)}%" data-l="${esc((p.name || 'J')[0].toUpperCase())}"></div>
      <h1>${esc(p.name)}</h1>
      <div class="title">Niveau ${lv.level} · ${esc(lv.title)}</div>
      <div class="xp-line"><span>${s.xp} XP</span><span>${lv.next ? `${lv.next - s.xp} XP avant le niveau ${lv.level + 1}` : 'Niveau maximum'}</span></div>
      <div class="bar"><i style="width:${Math.round(lv.progress * 100)}%"></i></div>
    </div>

    <div class="section">
      <h2>Statistiques</h2>
      <div class="stats">
        <div class="stat"><b>${s.valid}</b><span>cartes</span></div>
        <div class="stat"><b>${s.types}</b><span>types / ${s.catalogSize}</span></div>
        <div class="stat"><b>${s.makers}</b><span>constructeurs</span></div>
        <div class="stat"><b>${s.places}</b><span>aéroports</span></div>
        <div class="stat"><b>${Math.round(s.successRate * 100)} %</b><span>photos réussies</span></div>
        <div class="stat"><b>${s.best ? s.best.points : 0}</b><span>meilleure carte</span></div>
      </div>
    </div>

    <div class="section">
      <h2>Cartes par rareté</h2>
      <div class="rar-bars">
        ${Object.entries(RARITIES).map(([k, r]) => `
          <div class="rb" style="--c:${r.color}"><span>${r.label}</span>
            <div class="bar"><i style="width:${Math.round((s.byRarity[k] / maxRarity) * 100)}%"></i></div><em>${s.byRarity[k]}</em></div>`).join('')}
      </div>
    </div>

    <div class="section">
      <h2>Succès (${unlocked}/${ach.length})</h2>
      ${ach.map((a) => `
        <div class="ach ${a.unlocked ? '' : 'off'}">
          <span class="ico">${a.icon}</span>
          <div style="flex:1"><b>${esc(a.title)}</b><small>${esc(a.desc)}</small>
            ${!a.unlocked && a.progress ? `<div class="bar"><i style="width:${Math.min(100, Math.round((a.progress[0] / a.progress[1]) * 100))}%"></i></div>` : ''}
          </div>
          ${a.unlocked ? '<span class="done">✓</span>' : a.progress ? `<small>${Math.min(a.progress[0], a.progress[1])}/${a.progress[1]}</small>` : ''}
        </div>`).join('')}
    </div>

    ${accountHtml()}

    ${friendsHtml()}

    <div class="section settings">
      <h2>Réglages</h2>
      ${online ? `
      <div class="account">
        <div class="kv"><span>Pseudo</span><b>${esc(p.name)}</b></div>
        <div class="kv"><span>Pays (classement national)</span><b>${esc(regionName(p.country))}</b></div>
        <p class="muted">Le pseudo et le pays sont fixés à la création du compte. Pour les modifier, contacte le support.</p>
      </div>` : cs.user ? '' : `
      <label>Pseudo<input id="p-name" maxlength="20" value="${esc(p.name)}" /></label>
      <label>Pays<select id="p-country">${countryOptions(p.country)}</select></label>`}
      <div class="row2">
        <button id="p-copy">Copier les mesures</button>
        <button id="p-clear" class="danger">Tout effacer</button>
      </div>
    </div>
    <p class="foot-note">Prototype 0.4 · ${online ? 'tes captures sont sauvegardées sur ton compte' : 'les photos restent sur ce téléphone'}.<br />Immatriculations canadiennes : registre de Transport Canada (mis à jour chaque semaine).</p>`;

  const pName = $('p-name');
  if (pName) {
    // Sans compte seulement : pseudo et pays locaux (repris comme proposition à la création du compte).
    pName.addEventListener('change', (e) => {
      saveProfile({ ...loadProfile(), name: e.target.value.trim() || 'Joueur' });
      renderProfile();
    });
    $('p-country').addEventListener('change', (e) => {
      saveProfile({ ...loadProfile(), country: e.target.value });
      renderProfile();
    });
  }
  $('p-copy').addEventListener('click', ctx.onCopy);
  $('p-clear').addEventListener('click', ctx.onClear);
  bindAccount();
}
