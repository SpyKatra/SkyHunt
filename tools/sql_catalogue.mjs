// Génère le SQL du catalogue côté serveur (types → rareté et militaire, raretés → points) depuis web/catalog.js.
// (La colonne « military » existe depuis 20261106120000_anti_triche.sql.)
// Le serveur en a besoin pour calculer les points des classements. Après un ajout dans le catalogue :
//   node tools/sql_catalogue.mjs > supabase/migrations/<date>_catalogue.sql
// (nouvelle migration ; tests/cloud.js vérifie que le serveur et web/catalog.js sont identiques).
import { AIRCRAFT, RARITIES } from '../web/catalog.js';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rar = Object.entries(RARITIES).map(([id, r]) => `  (${q(id)}, ${r.points})`).join(',\n');
const types = AIRCRAFT.map((a) => `  (${q(a.id)}, ${q(a.rarity)}, ${a.category === 'militaire'})`).join(',\n');
console.log(`-- Généré par tools/sql_catalogue.mjs depuis web/catalog.js : ne pas modifier à la main.
insert into public.rarities (id, points) values
${rar}
on conflict (id) do update set points = excluded.points;

insert into public.aircraft_types (id, rarity, military) values
${types}
on conflict (id) do update set rarity = excluded.rarity, military = excluded.military;`);
