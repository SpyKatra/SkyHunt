// Carte du monde de toutes les captures (Leaflet + tuiles OpenStreetMap).
/* global L */
import { RARITIES, getType } from './catalog.js';
import { $, esc, fmtDate, photoUrl, placeLabel } from './ui-common.js';

let map = null;
let layer = null;
let ctx = null;

export function initMap(context) {
  ctx = context;
}

function ensureMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([46.79, -71.39], 10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  layer = L.layerGroup().addTo(map);
}

export function renderMap() {
  ensureMap();
  // Le conteneur vient d'apparaître : Leaflet doit recalculer sa taille.
  setTimeout(() => map.invalidateSize(), 0);

  const list = ctx.getList().filter((c) => c.valid && c.latitude != null);
  layer.clearLayers();
  const pts = [];
  for (const c of list) {
    const t = getType(c.typeId);
    const r = RARITIES[t.rarity];
    const m = L.circleMarker([c.latitude, c.longitude], {
      radius: 8 + r.order * 2, color: '#0b1220', weight: 2, fillColor: r.color, fillOpacity: 0.95,
    });
    m.bindPopup(`<div class="map-pop"><img src="${photoUrl(c)}" alt="" />
      <b>${esc(t.name)}</b><br />${esc(r.label)} · ${c.points} pts<br />${esc(placeLabel(c))} · ${esc(fmtDate(c.takenAt))}
      <br /><a href="#" data-open="${esc(c.id)}">Voir la carte</a></div>`);
    m.addTo(layer);
    pts.push([c.latitude, c.longitude]);
  }

  const places = new Set(list.map((c) => placeLabel(c)));
  $('map-info').innerHTML = `<span><b>${list.length}</b> captures · <b>${places.size}</b> lieux</span>
    <button id="map-fit">Recentrer</button>`;
  const fit = () => {
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
  };
  $('map-fit').onclick = fit;
  setTimeout(fit, 50);
}

export function bindMapPopupLinks(openDetail) {
  $('map').addEventListener('click', (e) => {
    const a = e.target.closest('[data-open]');
    if (!a) return;
    e.preventDefault();
    openDetail(a.dataset.open);
  });
}
