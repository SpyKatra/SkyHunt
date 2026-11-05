// Animation de révélation d'une nouvelle carte, avec le détail des points.
import { RARITIES, getType } from './catalog.js';
import { $, cardHtml, esc } from './ui-common.js';

export function breakdownHtml(c) {
  const b = c.breakdown;
  if (!b) return '';
  if (b.blocked) {
    return `<div class="breakdown"><div class="line"><span>${esc(b.blocked)}</span><span>0 pt</span></div>
      <div class="line total"><span>Total</span><span>0 pt</span></div></div>`;
  }
  const lines = [
    ['Appareil', `${b.aircraft} pts`],
    ['Lieu', `${b.place} pt`],
  ];
  if (b.Q !== 1) lines.push(['Photo excellente', `×${String(b.Q).replace('.', ',')}`]);
  if (b.R !== 1) lines.push([`Déjà capturé ${b.repeat} fois`, `×${String(b.R).replace('.', ',')}`]);
  if (b.bonus) lines.push(['Nouveau type dans ta flotte', `+${b.bonus}`]);
  if (b.regSeen) lines.push(['Immatriculation déjà capturée', '0 pt']);
  return `<div class="breakdown">
    ${lines.map(([k, v]) => `<div class="line"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
    <div class="line total"><span>Total</span><span>${c.points} pts</span></div>
  </div>`;
}

/**
 * Affiche la révélation et attend « Continuer ».
 * extras : { levelUp: {level,title} | null, achievements: [{icon,title}] }
 */
export function reveal(c, extras = {}) {
  const t = getType(c.typeId);
  const r = RARITIES[t.rarity];
  const root = $('reveal');
  root.style.setProperty('--g', r.glow);
  $('reveal-card').innerHTML = cardHtml(c, { showPoints: false });
  let html = `<div class="reveal-points">+${c.points} pts</div>`;
  if (t.id === 'inconnu') html += '<span class="pill">Avion mystère : identifie-le plus tard depuis tes cartes pour gagner plus de points.</span>';
  else if (c.breakdown?.bonus) html += `<span class="pill green">Nouveau type : ${esc(t.name)} rejoint ta flotte !</span>`;
  if (extras.levelUp) html += `<span class="pill gold">Niveau ${extras.levelUp.level} atteint : ${esc(extras.levelUp.title)}</span>`;
  for (const a of extras.achievements || []) html += `<span class="pill gold">${a.icon} Succès débloqué : ${esc(a.title)}</span>`;
  html += `<div style="margin-top:10px">${breakdownHtml(c)}</div>`;
  $('reveal-details').innerHTML = html;

  // Relance les animations CSS.
  root.classList.add('hidden');
  void root.offsetWidth;
  root.classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate(r.order >= 2 ? [60, 40, 120] : 40);

  return new Promise((resolve) => {
    $('reveal-ok').onclick = () => {
      root.classList.add('hidden');
      resolve();
    };
  });
}
