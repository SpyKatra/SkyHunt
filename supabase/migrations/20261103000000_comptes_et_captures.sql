-- SkyHunt — étape 1 : comptes (profils) et captures envoyées par le téléphone.
--
-- Principes :
--  * chaque joueur ne voit et ne modifie que ses propres données (RLS) ;
--  * les points ne sont PAS stockés : ils se recalculent à partir des captures ;
--  * les mesures d'une capture (heure, position, détection) sont figées après l'envoi :
--    seule l'identification (type, immatriculation) peut être corrigée ;
--  * les photos vont dans le compartiment privé « captures », sous <id du joueur>/<id local>.jpg,
--    sans possibilité de les remplacer.

create extension if not exists postgis with schema extensions;

-- ============================================================ Profils
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  pseudo      text not null check (char_length(btrim(pseudo)) between 2 and 20),
  country     text not null check (country ~ '^[A-Z]{2}$'),   -- code ISO 3166-1 alpha-2
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_pseudo_unique on public.profiles (lower(btrim(pseudo)));

comment on table public.profiles is 'Un profil par compte : pseudo (unique) et pays du classement national.';

-- ============================================================ Captures
create table public.captures (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id            text not null check (char_length(client_id) between 1 and 64),
  taken_at             timestamptz not null,
  uploaded_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Position
  latitude             double precision check (latitude between -90 and 90),
  longitude            double precision check (longitude between -180 and 180),
  accuracy_m           real,
  gps_age_s            integer,
  position             extensions.geography(Point, 4326) generated always as (
                         case when latitude is not null and longitude is not null
                              then extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
                         end) stored,

  -- Photo et détection (mesurées sur le téléphone ; contrôles serveur à l'étape 4)
  width                integer,
  height               integer,
  confidence           real,
  size_ratio           real,
  sharpness            real,
  brightness           real,
  box                  jsonb,
  thresholds           jsonb,
  valid                boolean not null,
  reasons              text[] not null default '{}',
  photo_path           text,
  user_agent           text,

  -- Identification (modifiable par le joueur)
  type_id              text,
  registration         text check (registration is null or char_length(registration) <= 12),
  registration_source  text,
  registry_model       text,

  unique (user_id, client_id),
  check (photo_path is null or photo_path = user_id::text || '/' || client_id || '.jpg')
);
create index captures_user_taken on public.captures (user_id, taken_at desc);
create index captures_position on public.captures using gist (position);
create index captures_registration on public.captures (registration) where registration is not null;

comment on table public.captures is 'Captures envoyées par l''app. Les points sont recalculés côté app (puis serveur), jamais stockés.';

-- ============================================================ Déclencheurs
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Fige tout sauf l'identification et le chemin de la photo.
create function public.captures_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.user_id, new.client_id, new.taken_at, new.uploaded_at,
      new.latitude, new.longitude, new.accuracy_m, new.gps_age_s,
      new.width, new.height, new.confidence, new.size_ratio, new.sharpness, new.brightness,
      new.box, new.thresholds, new.valid, new.reasons, new.user_agent)
     is distinct from
     (old.id, old.user_id, old.client_id, old.taken_at, old.uploaded_at,
      old.latitude, old.longitude, old.accuracy_m, old.gps_age_s,
      old.width, old.height, old.confidence, old.size_ratio, old.sharpness, old.brightness,
      old.box, old.thresholds, old.valid, old.reasons, old.user_agent)
  then
    raise exception 'Les mesures d''une capture ne peuvent pas être modifiées'
      using errcode = 'check_violation';
  end if;
  if old.photo_path is not null and new.photo_path is distinct from old.photo_path then
    raise exception 'La photo d''une capture ne peut pas être remplacée' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger captures_guard before update on public.captures
  for each row execute function public.captures_guard_update();

-- Une capture ne peut pas être datée dans le futur (5 min de tolérance d'horloge).
create function public.captures_guard_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.taken_at > now() + interval '5 minutes' then
    raise exception 'Date de capture dans le futur' using errcode = 'check_violation';
  end if;
  new.uploaded_at := now();
  new.updated_at := now();
  return new;
end $$;

create trigger captures_guard_ins before insert on public.captures
  for each row execute function public.captures_guard_insert();

-- ============================================================ Sécurité ligne par ligne
alter table public.profiles enable row level security;
alter table public.captures enable row level security;

create policy "profil : lecture du sien" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profil : création du sien" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "profil : modification du sien" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "captures : lecture des siennes" on public.captures
  for select to authenticated using (user_id = (select auth.uid()));
create policy "captures : envoi des siennes" on public.captures
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "captures : identification des siennes" on public.captures
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "captures : suppression des siennes" on public.captures
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.profiles, public.captures from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.captures to authenticated;

-- ============================================================ Suppression du compte
-- Exigée par l'App Store et la Loi 25. L'app efface d'abord les photos (API Storage),
-- puis appelle cette fonction ; profil et captures partent en cascade.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Non connecté' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ============================================================ Photos (Storage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 6 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Dossier = id du joueur. Pas de politique UPDATE : une photo envoyée ne peut pas être remplacée.
create policy "photos : envoi dans son dossier" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos : lecture de son dossier" on storage.objects
  for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos : suppression dans son dossier" on storage.objects
  for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
