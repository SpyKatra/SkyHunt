// Génère le SQL du catalogue côté serveur depuis web/catalog.js (web/fleet.js) :
// raretés → points, types → rareté et militaire, séries → type.
// (Colonne « military » : 20261106120000_anti_triche.sql ; table aircraft_series : 20261107120000_series.sql.)
// Le serveur en a besoin pour calculer les points des classements. Après un ajout dans le catalogue :
//   node tools/sql_catalogue.mjs > supabase/migrations/<date>_catalogue.sql
// (nouvelle migration ; tests/cloud.js vérifie que le serveur et web/catalog.js sont identiques).
import { AIRCRAFT, RARITIES } from '../web/catalog.js';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rar = Object.entries(RARITIES).map(([id, r]) => `  (${q(id)}, ${r.points})`).join(',\n');
const types = AIRCRAFT.map((a) => `  (${q(a.id)}, ${q(a.rarity)}, ${a.category === 'militaire'})`).join(',\n');
const series = AIRCRAFT.flatMap((a) => a.series.map((s) => `  (${q(s.id)}, ${q(a.id)})`)).join(',\n');
console.log(`-- Généré par tools/sql_catalogue.mjs depuis web/catalog.js : ne pas modifier à la main.
insert into public.rarities (id, points) values
${rar}
on conflict (id) do update set points = excluded.points;

insert into public.aircraft_types (id, rarity, military) values
${types}
on conflict (id) do update set rarity = excluded.rarity, military = excluded.military;

insert into public.aircraft_series (id, type_id) values
${series}
on conflict (id) do update set type_id = excluded.type_id;`);
