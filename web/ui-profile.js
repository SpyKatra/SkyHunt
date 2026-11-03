// Écran « Profil » : niveau, XP, statistiques, succès et réglages.
import { RARITIES } from './catalog.js';
import { achievementState, computeStats, levelFor } from './game.js';
import { $, esc } from './ui-common.js';

const COUNTRIES = ['Canada', 'France', 'Belgique', 'Suisse', 'États-Unis', 'Royaume-Uni', 'Autre'];

export function loadProfile() {
  try {
    return { name: 'Joueur', country: 'Canada', ...JSON.parse(localStorage.getItem('skyhunt.profile') || '{}') };
  } catch {
    return { name: 'Joueur', country: 'Canada' };
  }
}
function saveProfile(p) {
  try { localStorage.setItem('skyhunt.profile', JSON.stringify(p)); } catch { /* mode privé */ }
}

let ctx = null; // { getList, onCopy, onClear }

export function initProfile(context) {
  ctx = context;
}

export function renderProfile() {
  const list = ctx.getList();
  const s = computeStats(list);
  const lv = levelFor(s.xp);
  const p = loadProfile();
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

    <div class="section settings">
      <h2>Réglages</h2>
      <label>Pseudo<input id="p-name" maxlength="20" value="${esc(p.name)}" /></label>
      <label>Pays du compte (classement national, bientôt)
        <select id="p-country">${COUNTRIES.map((c) => `<option ${c === p.country ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <div class="row2">
        <button id="p-copy">Copier les mesures</button>
        <button id="p-clear" class="danger">Tout effacer</button>
      </div>
    </div>
    <p class="foot-note">Prototype 0.3 · les photos restent sur ce téléphone.<br />Immatriculations canadiennes : registre de Transport Canada (mis à jour chaque semaine).</p>`;

  $('p-name').addEventListener('change', (e) => {
    saveProfile({ ...loadProfile(), name: e.target.value.trim() || 'Joueur' });
    renderProfile();
  });
  $('p-country').addEventListener('change', (e) => saveProfile({ ...loadProfile(), country: e.target.value }));
  $('p-copy').addEventListener('click', ctx.onCopy);
  $('p-clear').addEventListener('click', ctx.onClear);
}
