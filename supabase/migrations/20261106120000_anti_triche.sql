-- SkyHunt — étape 4 (anti-triche serveur, première partie) et avertissement militaire.
--
-- 1. Militaire : les types militaires du catalogue sont marqués ; une capture d'un type militaire ne compte
--    que si le joueur a accepté l'avertissement (captures.military_ack_at, date enregistrée).
-- 2. Jetons de capture à usage unique : le téléphone garde une réserve de jetons (demandés quand il a du réseau)
--    et en attache un à chaque photo. Jeton valide → la capture garde son heure réelle (« vérifiée »).
--    Sans jeton valide, le serveur la date à sa réception. Effet : impossible d'antidater une capture pour
--    passer avant les autres (rareté des lieux) ou pour la compter dans un mois passé.
--    Un jeton ne prouve pas que la photo est vraie (ce sera App Attest / Play Integrity) : il fixe une heure
--    minimale (on ne peut pas dater une photo d'avant l'émission du jeton) et ne sert qu'une fois.
-- 3. Photos en double : une empreinte de chaque photo envoyée est calculée PAR LE SERVEUR (fonction Edge
--    photo-hash, appelée par un déclencheur) : miniature 16 × 12 en gris, moins les moyennes de chaque ligne et
--    de chaque colonne (le dégradé du ciel disparaît, il reste la silhouette), normée. Une photo dont la
--    miniature ressemble à celle d'une photo déjà envoyée (tous joueurs, corrélation ≥ 0,9) vaut 0 point.
--    (Un simple dHash ne suffit pas : dans un ciel uni, ses bits basculent au moindre bruit de compression.)
--
-- Les règles de points restent celles de web/game.js : une capture « non comptée » (refusée, en double, ou
-- militaire sans avertissement accepté) vaut 0 et ne compte pas pour la répétition (R) ni le bonus.

-- ============================================================ 1. Militaire
alter table public.aircraft_types add column military boolean not null default false;
update public.aircraft_types set military = true
where id in ('c130', 'c17', 'a330mrtt', 'f18', 'f35', 'f22', 'b2', 'u2');   -- catégorie « militaire » de web/catalog.js

alter table public.captures add column military_ack_at timestamptz
  check (military_ack_at is null or military_ack_at <= now() + interval '5 minutes');
comment on column public.captures.military_ack_at is
  'Acceptation de l''avertissement « appareil militaire » (date, heure) ; obligatoire pour qu''une capture militaire compte.';

-- ============================================================ 2. Jetons de capture
create table private.capture_tokens (
  token       uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  issued_at   timestamptz not null default now(),
  used_at     timestamptz,
  used_by     text                                  -- client_id de la capture
);
create index capture_tokens_user on private.capture_tokens (user_id, issued_at);
revoke all on private.capture_tokens from public, anon, authenticated;

alter table public.captures add column capture_token uuid;
alter table public.captures add column verified boolean not null default false;
comment on column public.captures.verified is
  'Jeton de capture valide (posé par le serveur) : l''heure de la capture est crédible. Sinon, heure de réception.';
-- Captures d'avant les jetons : on garde leur heure.
update public.captures set verified = true;

-- Durée de vie d'un jeton : une capture faite hors ligne peut attendre une semaine avant d'être envoyée.
create function public.issue_capture_tokens(p_count integer default 20)
returns table (token uuid, issued_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  have integer;
  today integer;
  n integer;
begin
  if uid is null then
    raise exception 'Non connecté' using errcode = 'insufficient_privilege';
  end if;
  delete from private.capture_tokens t
  where t.user_id = uid and (t.used_at is null and t.issued_at < now() - interval '7 days'
                             or t.used_at < now() - interval '30 days');
  select count(*) into have from private.capture_tokens t where t.user_id = uid and t.used_at is null;
  select count(*) into today from private.capture_tokens t where t.user_id = uid and t.issued_at > now() - interval '1 day';
  -- au plus 20 jetons en réserve et 200 par jour
  n := greatest(0, least(coalesce(p_count, 20), 20 - have, 200 - today));
  return query
    insert into private.capture_tokens (user_id)
    select uid from generate_series(1, n)
    returning capture_tokens.token, capture_tokens.issued_at;
end $$;
revoke all on function public.issue_capture_tokens(integer) from public, anon;
grant execute on function public.issue_capture_tokens(integer) to authenticated;

-- À l'envoi : jeton du joueur, jamais utilisé, émis avant la photo (2 min de tolérance d'horloge),
-- photo prise au plus 7 jours après l'émission. Le client ne peut pas poser « verified » lui-même.
create function public.captures_check_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.verified := false;
  if new.capture_token is not null then
    update private.capture_tokens t
    set used_at = now(), used_by = new.client_id
    where t.token = new.capture_token
      and t.user_id = new.user_id
      and t.used_at is null
      and t.issued_at <= new.taken_at + interval '2 minutes'
      and new.taken_at <= t.issued_at + interval '7 days';
    new.verified := found;
  end if;
  return new;
end $$;
create trigger captures_token_ins before insert on public.captures
  for each row execute function public.captures_check_token();

create function public.captures_guard_token() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.verified is distinct from old.verified or new.capture_token is distinct from old.capture_token then
    raise exception 'Le jeton d''une capture ne peut pas être modifié' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger captures_token_guard before update on public.captures
  for each row execute function public.captures_guard_token();

-- Heure qui compte pour les autres joueurs (rareté des lieux, classement du mois).
create function private.counted_at(c public.captures) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when c.verified then c.taken_at else greatest(c.taken_at, c.uploaded_at) end
$$;

-- Rareté des lieux : captures valides faites AVANT (heure qui compte) à moins de 5 km.
create or replace function private.place_points(p_position extensions.geography, p_taken_at timestamptz)
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
          and private.counted_at(o) < p_taken_at
          and extensions.st_dwithin(o.position, p_position, 5000)
      ) c
    )
  end
$$;

-- ============================================================ 3. Photos en double
create table private.photo_hashes (
  user_id         uuid not null references auth.users (id) on delete cascade,
  client_id       text not null,
  thumb           real[] not null check (cardinality(thumb) = 192),  -- empreinte (16 × 12, centrée, norme 1)
  hashed_at       timestamptz not null default now(),
  duplicate_user  uuid,                          -- photo déjà envoyée dont celle-ci est la copie
  duplicate_client text,
  similarity      real,                          -- plus forte ressemblance avec une photo déjà envoyée
  primary key (user_id, client_id)
);
revoke all on private.photo_hashes from public, anon, authenticated;

-- Adresse de la fonction Edge (la base de données locale la remplace dans supabase/seed.sql).
create table private.settings (key text primary key, value text not null);
revoke all on private.settings from public, anon, authenticated;
insert into private.settings (key, value)
values ('photo_hash_url', 'https://jujomunxljjjrtetqvoe.supabase.co/functions/v1/photo-hash');

create extension if not exists pg_net;

-- Dès qu'une capture reçoit sa photo, le serveur demande son empreinte (appel asynchrone, ne bloque rien).
create function public.captures_request_hash() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  url text;
begin
  if new.photo_path is not null and (tg_op = 'INSERT' or old.photo_path is null) then
    select value into url from private.settings where key = 'photo_hash_url';
    if url is not null then
      -- 30 s : au premier appel, la fonction démarre « à froid » (chargement de ses modules).
      perform net.http_post(url := url, body := jsonb_build_object('path', new.photo_path),
                            headers := jsonb_build_object('Content-Type', 'application/json'),
                            timeout_milliseconds := 30000);
    end if;
  end if;
  return new;
end $$;
create trigger captures_hash_request after insert or update of photo_path on public.captures
  for each row execute function public.captures_request_hash();

-- Appelée par la fonction Edge (rôle service seulement). La première empreinte reçue est gardée
-- (une photo ne peut pas être remplacée) ; la photo déjà envoyée la plus ressemblante est notée.
-- Ressemblance = produit scalaire des empreintes (corrélation, de -1 à 1). Parcourt toutes les empreintes :
-- suffisant pour la bêta (quelques milliers de photos) ; à indexer (pgvector) plus tard.
create function public.record_photo_hash(p_path text, p_thumb real[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid;
  cid text;
  dup record;
  limit_sim constant real := 0.9;
begin
  if p_path !~ '^[0-9a-f-]{36}/.+\.jpg$' then
    raise exception 'Chemin de photo invalide';
  end if;
  if cardinality(p_thumb) <> 192 then
    raise exception 'Empreinte invalide';
  end if;
  uid := split_part(p_path, '/', 1)::uuid;
  cid := regexp_replace(split_part(p_path, '/', 2), '\.jpg$', '');
  if exists (select 1 from private.photo_hashes h where h.user_id = uid and h.client_id = cid) then
    return jsonb_build_object('deja', true);
  end if;
  select h.user_id, h.client_id, s.sim
  into dup
  from private.photo_hashes h
  cross join lateral (select sum(a * b)::real as sim from unnest(h.thumb, p_thumb) as u(a, b)) s
  order by s.sim desc, h.hashed_at
  limit 1;
  insert into private.photo_hashes (user_id, client_id, thumb, duplicate_user, duplicate_client, similarity)
  values (uid, cid, p_thumb,
          case when dup.sim >= limit_sim then dup.user_id end,
          case when dup.sim >= limit_sim then dup.client_id end,
          dup.sim);
  return jsonb_build_object('double', coalesce(dup.sim >= limit_sim, false), 'ressemblance', dup.sim);
end $$;
revoke all on function public.record_photo_hash(text, real[]) from public, anon, authenticated;
grant execute on function public.record_photo_hash(text, real[]) to service_role;

-- Rattrapage (administrateur, SQL) : redemande l'empreinte des photos qui n'en ont pas (appel perdu,
-- fonction pas encore déployée…) : select public.request_missing_hashes();
create function public.request_missing_hashes() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  url text;
  n integer := 0;
  c record;
begin
  select value into url from private.settings where key = 'photo_hash_url';
  for c in
    select x.photo_path from public.captures x
    left join private.photo_hashes h on h.user_id = x.user_id and h.client_id = x.client_id
    where x.photo_path is not null and h.user_id is null
  loop
    perform net.http_post(url := url, body := jsonb_build_object('path', c.photo_path),
                          headers := jsonb_build_object('Content-Type', 'application/json'),
                          timeout_milliseconds := 30000);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.request_missing_hashes() from public, anon, authenticated;
grant execute on function public.request_missing_hashes() to service_role;

-- ============================================================ Points (même règles que web/game.js)
-- Colonnes ajoutées à la fin de la vue : counted (capture qui compte), counted_at (heure qui compte), duplicate.
create or replace view private.scored_captures as
with base as (
  select
    c.id, c.user_id, c.client_id, c.taken_at, c.valid,
    coalesce(r.points, 2) as aircraft_points,
    (t.id is not null) as known,
    c.type_id,
    nullif(upper(regexp_replace(coalesce(c.registration, ''), '[^A-Za-z0-9]', '', 'g')), '') as reg,
    case when c.confidence >= 0.8 and c.size_ratio >= 0.4 then 1.2 else 1 end::numeric as q,
    private.place_points(c.position, private.counted_at(c)) as place,
    private.counted_at(c) as counted_at,
    (h.duplicate_user is not null) as duplicate,
    (c.valid and h.duplicate_user is null and not (coalesce(t.military, false) and c.military_ack_at is null)) as counted
  from public.captures c
  left join public.aircraft_types t on t.id = c.type_id
  left join public.rarities r on r.id = t.rarity
  left join private.photo_hashes h on h.user_id = c.user_id and h.client_id = c.client_id
),
ranked as (
  select b.*,
    case when b.counted and b.known
      then row_number() over (partition by b.user_id, b.counted, b.known, b.type_id order by b.taken_at, b.client_id) - 1
      else 0 end as repeat_n,
    case when b.counted and b.reg is not null
      then row_number() over (partition by b.user_id, b.counted, b.reg order by b.taken_at, b.client_id) > 1
      else false end as reg_seen
  from base b
)
select
  id, user_id, client_id, taken_at, valid, place,
  case
    when not counted or reg_seen then 0
    else round((aircraft_points + place)::numeric * q
               * (case repeat_n when 0 then 1 when 1 then 0.5 when 2 then 0.25 else 0.1 end)::numeric)::integer
         + case when known and repeat_n = 0 then 5 else 0 end
  end as points,
  counted, counted_at, duplicate
from ranked;
revoke all on private.scored_captures from public, anon, authenticated;

-- my_scores renvoie aussi « duplicate » (photo en double) pour que l'app affiche 0 point comme le serveur.
drop function public.my_scores();
create function public.my_scores()
returns table (client_id text, place_points integer, points integer, duplicate boolean)
language sql stable security definer set search_path = '' as $$
  select s.client_id, s.place, s.points, s.duplicate
  from private.scored_captures s
  where s.user_id = (select auth.uid())
$$;
revoke all on function public.my_scores() from public, anon;
grant execute on function public.my_scores() to authenticated;

-- Classements : le mois se juge sur l'heure qui compte ; seules les captures qui comptent sont des « cartes ».
create or replace function public.leaderboard(p_country text default null, p_month date default null, p_limit integer default 100)
returns table (rank bigint, pseudo text, country text, points bigint, captures bigint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with totals as (
    select p.id, p.pseudo, p.country,
           coalesce(sum(s.points), 0)::bigint as points,
           count(s.id) filter (where s.counted)::bigint as captures
    from public.profiles p
    left join private.scored_captures s
      on s.user_id = p.id
     and (p_month is null or (s.counted_at >= date_trunc('month', p_month::timestamp) at time zone 'UTC'
                          and s.counted_at < (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'UTC'))
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

create or replace function public.friends_leaderboard(p_month date default null)
returns table (rank bigint, pseudo text, country text, points bigint, captures bigint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select private.require_user() as uid),
  members as (
    select me.uid as id from me
    union
    select case when f.requester = me.uid then f.addressee else f.requester end
    from private.friendships f, me
    where f.status = 'accepted' and me.uid in (f.requester, f.addressee)
  ),
  totals as (
    select p.id, p.pseudo, p.country,
           coalesce(sum(s.points), 0)::bigint as points,
           count(s.id) filter (where s.counted)::bigint as captures
    from members m
    join public.profiles p on p.id = m.id
    left join private.scored_captures s
      on s.user_id = p.id
     and (p_month is null or (s.counted_at >= date_trunc('month', p_month::timestamp) at time zone 'UTC'
                          and s.counted_at < (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'UTC'))
    group by p.id, p.pseudo, p.country
  )
  select rank() over (order by t.points desc), t.pseudo, t.country, t.points, t.captures, t.id = (select uid from me)
  from totals t
  order by 1, 2
$$;
