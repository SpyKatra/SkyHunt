-- SkyHunt — étape 2 : classements (mondial, national, mensuel) et rareté des lieux.
--
-- Les points ne sont toujours PAS stockés : la vue private.scored_captures les recalcule à partir
-- des captures, avec les mêmes règles que web/game.js (recomputeAll) :
--   Score = (P_appareil + P_lieu) × Q × R + Bonus, arrondi ;
--   Q = 1,2 si confiance ≥ 0,8 et taille ≥ 0,4 ; R = 1 ; 0,5 ; 0,25 ; 0,1 selon les captures
--   précédentes du même type ; Bonus +5 au premier exemplaire d'un type ; immatriculation déjà
--   capturée = 0 point. Les captures refusées valent 0.
--
-- P_lieu (nouveau, remplace le point fixe) : nombre de captures valides, tous joueurs confondus,
-- faites AVANT celle-ci à moins de 5 km :
--   aucune → 5 (lieu découvert) ; 1 à 9 → 3 ; 10 à 49 → 2 ; 50 et plus → 1 ; sans position → 1.
-- « Avant » rend le calcul stable : une capture ne perd pas de points quand d'autres arrivent ensuite.
--
-- Mensuel : points des captures prises pendant le mois (UTC), la répétition (R) tenant compte de
-- tout l'historique du joueur. Seuls pseudo, pays et totaux sont visibles des autres joueurs.

-- ============================================================ Catalogue (copie de web/catalog.js)
create table public.rarities (
  id      text primary key,
  points  integer not null check (points > 0)
);
create table public.aircraft_types (
  id      text primary key,
  rarity  text not null references public.rarities (id)
);
comment on table public.aircraft_types is 'Copie de web/catalog.js (tools/sql_catalogue.mjs) : rareté de chaque type, pour les points du serveur.';

alter table public.rarities enable row level security;
alter table public.aircraft_types enable row level security;
create policy "raretés : lecture" on public.rarities for select to authenticated using (true);
create policy "types : lecture" on public.aircraft_types for select to authenticated using (true);
revoke all on public.rarities, public.aircraft_types from anon;
grant select on public.rarities, public.aircraft_types to authenticated;

-- Pour la recherche des captures voisines (rareté des lieux).
create index captures_valid_position on public.captures using gist (position) where valid;

-- ============================================================ Calcul des points (privé)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.place_points(p_position extensions.geography, p_taken_at timestamptz)
returns integer
language sql stable set search_path = '' as $$
  select case
    when p_position is null then 1
    else (
      select case when n = 0 then 5 when n < 10 then 3 when n < 50 then 2 else 1 end
      from (
        select count(*) as n
        from public.captures o
        where o.valid
          and o.taken_at < p_taken_at
          and extensions.st_dwithin(o.position, p_position, 5000)
      ) c
    )
  end
$$;

create view private.scored_captures as
with base as (
  select
    c.id, c.user_id, c.client_id, c.taken_at, c.valid,
    coalesce(r.points, 2) as aircraft_points,
    (t.id is not null) as known,
    c.type_id,
    nullif(upper(regexp_replace(coalesce(c.registration, ''), '[^A-Za-z0-9]', '', 'g')), '') as reg,
    case when c.confidence >= 0.8 and c.size_ratio >= 0.4 then 1.2 else 1 end::numeric as q,
    private.place_points(c.position, c.taken_at) as place
  from public.captures c
  left join public.aircraft_types t on t.id = c.type_id
  left join public.rarities r on r.id = t.rarity
),
ranked as (
  select b.*,
    -- captures valides précédentes du même type connu (n de recomputeAll)
    case when b.valid and b.known
      then row_number() over (partition by b.user_id, b.valid, b.known, b.type_id order by b.taken_at, b.client_id) - 1
      else 0 end as repeat_n,
    -- immatriculation déjà capturée (valide) auparavant
    case when b.valid and b.reg is not null
      then row_number() over (partition by b.user_id, b.valid, b.reg order by b.taken_at, b.client_id) > 1
      else false end as reg_seen
  from base b
)
select
  id, user_id, client_id, taken_at, valid, place,
  case
    when not valid or reg_seen then 0
    else round((aircraft_points + place)::numeric * q
               * (case repeat_n when 0 then 1 when 1 then 0.5 when 2 then 0.25 else 0.1 end)::numeric)::integer
         + case when known and repeat_n = 0 then 5 else 0 end
  end as points
from ranked;

revoke all on private.scored_captures from public, anon, authenticated;

-- ============================================================ Fonctions appelées par l'app
-- Points de lieu et points (calculés par le serveur) de chacune de MES captures.
create function public.my_scores()
returns table (client_id text, place_points integer, points integer)
language sql stable security definer set search_path = '' as $$
  select s.client_id, s.place, s.points
  from private.scored_captures s
  where s.user_id = (select auth.uid())
$$;

-- Classement : p_country null = mondial, sinon national (code ISO) ;
-- p_month null = depuis le début, sinon le mois (UTC) qui contient cette date.
-- Renvoie les p_limit premiers, plus la ligne du joueur connecté s'il est plus loin.
create function public.leaderboard(p_country text default null, p_month date default null, p_limit integer default 100)
returns table (rank bigint, pseudo text, country text, points bigint, captures bigint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with totals as (
    select p.id, p.pseudo, p.country,
           coalesce(sum(s.points), 0)::bigint as points,
           count(s.id) filter (where s.valid)::bigint as captures
    from public.profiles p
    left join private.scored_captures s
      on s.user_id = p.id
     and (p_month is null or (s.taken_at >= date_trunc('month', p_month::timestamp) at time zone 'UTC'
                          and s.taken_at < (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'UTC'))
    where p_country is null or p.country = upper(p_country)
    group by p.id, p.pseudo, p.country
  ),
  ranked as (
    select rank() over (order by t.points desc) as rank, t.*
    from totals t
    where t.points > 0 or t.id = (select auth.uid())
  )
  select r.rank, r.pseudo, r.country, r.points, r.captures, r.id = (select auth.uid()) as is_me
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 100), 1), 500) or r.id = (select auth.uid())
  order by r.rank, r.pseudo
$$;

revoke all on function public.my_scores(), public.leaderboard(text, date, integer) from public, anon;
grant execute on function public.my_scores(), public.leaderboard(text, date, integer) to authenticated;

-- Généré par tools/sql_catalogue.mjs depuis web/catalog.js : ne pas modifier à la main.
insert into public.rarities (id, points) values
  ('commun', 2),
  ('peuCommun', 5),
  ('rare', 10),
  ('epique', 20),
  ('legendaire', 30)
on conflict (id) do update set points = excluded.points;

insert into public.aircraft_types (id, rarity) values
  ('a220-100', 'peuCommun'),
  ('a220-300', 'commun'),
  ('a319', 'commun'),
  ('a320', 'commun'),
  ('a321', 'commun'),
  ('a330', 'peuCommun'),
  ('a350', 'peuCommun'),
  ('a380', 'rare'),
  ('b737-700', 'commun'),
  ('b737-800', 'commun'),
  ('b737-max8', 'commun'),
  ('b737-classic', 'rare'),
  ('b757', 'peuCommun'),
  ('b767', 'peuCommun'),
  ('b777', 'peuCommun'),
  ('b787', 'peuCommun'),
  ('b747-400', 'rare'),
  ('e175', 'commun'),
  ('e190', 'commun'),
  ('crj200', 'commun'),
  ('crj900', 'commun'),
  ('dash8-100', 'peuCommun'),
  ('dash8-300', 'peuCommun'),
  ('dash8-400', 'commun'),
  ('dash7', 'rare'),
  ('jetstream', 'rare'),
  ('dornier', 'rare'),
  ('hs748', 'epique'),
  ('atr42', 'peuCommun'),
  ('atr72', 'peuCommun'),
  ('saab340', 'peuCommun'),
  ('b1900', 'peuCommun'),
  ('metro', 'rare'),
  ('twin-otter', 'peuCommun'),
  ('b747-8f', 'rare'),
  ('b777f', 'rare'),
  ('md11', 'rare'),
  ('f28', 'rare'),
  ('bae146', 'rare'),
  ('an124', 'epique'),
  ('beluga-xl', 'epique'),
  ('pc12', 'commun'),
  ('king-air', 'commun'),
  ('citation', 'commun'),
  ('challenger', 'peuCommun'),
  ('global', 'rare'),
  ('learjet', 'peuCommun'),
  ('g650', 'rare'),
  ('falcon', 'peuCommun'),
  ('phenom', 'peuCommun'),
  ('pc24', 'rare'),
  ('c172', 'commun'),
  ('pa28', 'commun'),
  ('caravan', 'commun'),
  ('beaver', 'peuCommun'),
  ('otter', 'rare'),
  ('cl415', 'rare'),
  ('dc3', 'epique'),
  ('at802', 'rare'),
  ('electra', 'epique'),
  ('convair', 'epique'),
  ('c130', 'rare'),
  ('c17', 'epique'),
  ('a330mrtt', 'epique'),
  ('f18', 'epique'),
  ('f35', 'epique'),
  ('f22', 'legendaire'),
  ('b2', 'legendaire'),
  ('u2', 'legendaire')
on conflict (id) do update set rarity = excluded.rarity;
