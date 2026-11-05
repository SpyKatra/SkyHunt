-- SkyHunt — classement entre amis, par code ami.
--
-- Principes (vie privée) :
--  * chaque compte a UN code ami fixe de 8 caractères (≈ 10¹² possibilités), créé une seule fois ;
--  * entrer un code n'ajoute personne : cela envoie une DEMANDE, que l'autre accepte ou refuse ;
--  * tant qu'une demande n'est pas acceptée, celui qui l'envoie ne voit pas le pseudo de l'autre
--    (seulement le code qu'il a tapé) : essayer des codes au hasard ne révèle rien ;
--  * une demande refusée ne peut être relancée par la même personne qu'au bout de 48 h
--    (l'expéditeur voit « refusée » et l'heure à partir de laquelle il pourra relancer) ;
--  * au plus 20 codes essayés par heure et 30 demandes en attente par joueur ;
--  * tout passe par des fonctions : aucune lecture directe des tables.

-- ============================================================ Codes amis
create table private.friend_codes (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  code        text not null unique check (code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  created_at  timestamptz not null default now()
);

-- 8 caractères sans 0/O ni 1/I, tirés de gen_random_uuid() (aléa cryptographique).
create function private.random_friend_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (get_byte(b, i) % 32) + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0, 7) i
$$;

-- Code du joueur : créé une seule fois (première demande), puis toujours le même.
create function private.friend_code_of(p_user uuid) returns text
language plpgsql volatile set search_path = '' as $$
declare
  c text;
begin
  select code into c from private.friend_codes where user_id = p_user;
  if c is not null then return c; end if;
  loop
    c := private.random_friend_code();
    begin
      insert into private.friend_codes (user_id, code) values (p_user, c);
      return c;
    exception when unique_violation then
      -- code déjà pris par un autre joueur (très rare) : on en tire un autre
    end;
  end loop;
end $$;

-- ============================================================ Amitiés et demandes
create table private.friendships (
  requester     uuid not null references auth.users (id) on delete cascade,
  addressee     uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  code_used     text not null,              -- montré à l'expéditeur tant que ce n'est pas accepté
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index friendships_pair on private.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee on private.friendships (addressee);

create table private.friend_attempts (
  user_id  uuid not null references auth.users (id) on delete cascade,
  at       timestamptz not null default now()
);
create index friend_attempts_user on private.friend_attempts (user_id, at);

revoke all on private.friend_codes, private.friendships, private.friend_attempts from public, anon, authenticated;
revoke all on function private.random_friend_code(), private.friend_code_of(uuid) from public, anon, authenticated;

-- ============================================================ Fonctions appelées par l'app
create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Non connecté' using errcode = 'insufficient_privilege';
  end if;
  return uid;
end $$;
revoke all on function private.require_user() from public, anon, authenticated;

-- Mon code ami (fixe).
create function public.my_friend_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  return private.friend_code_of(private.require_user());
end $$;

-- Envoie une demande à partir d'un code. Renvoie 'envoyée', 'acceptée' (si l'autre m'avait déjà
-- envoyé une demande, on devient amis tout de suite) ou 'inconnu' (code qui n'existe pas).
-- Un code inconnu n'est pas une erreur : une erreur annulerait l'enregistrement de l'essai,
-- et la limite de 20 essais par heure ne servirait à rien.
create function public.request_friend(p_code text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  target uuid;
  f private.friendships;
begin
  if not exists (select 1 from public.profiles where id = uid) then
    raise exception 'Choisis d''abord ton pseudo dans le profil.';
  end if;
  delete from private.friend_attempts where at < now() - interval '1 day';
  if (select count(*) from private.friend_attempts where user_id = uid and at > now() - interval '1 hour') >= 20 then
    raise exception 'Trop d''essais : réessaie dans une heure.';
  end if;
  insert into private.friend_attempts (user_id) values (uid);

  select user_id into target from private.friend_codes where code = c;
  if target is null then
    return 'inconnu';                         -- pas d'erreur : l'essai doit rester compté
  end if;
  if target = uid then
    raise exception 'C''est ton propre code.';
  end if;

  select * into f from private.friendships
  where (requester = uid and addressee = target) or (requester = target and addressee = uid);

  if found then
    if f.status = 'accepted' then
      raise exception 'Vous êtes déjà amis.';
    elsif f.requester = uid and f.status = 'pending' then
      return 'envoyée';                       -- déjà envoyée
    elsif f.requester = uid then
      -- refusée : relance possible 48 h après le refus
      if f.responded_at > now() - interval '48 hours' then
        raise exception 'Demande refusée : tu pourras relancer dans % h.',
          ceil(extract(epoch from f.responded_at + interval '48 hours' - now()) / 3600)::int;
      end if;
      update private.friendships set status = 'pending', created_at = now(), responded_at = null, code_used = c
      where requester = uid and addressee = target;
      return 'envoyée';
    elsif f.status = 'pending' then
      update private.friendships set status = 'accepted', responded_at = now()
      where requester = target and addressee = uid;
      return 'acceptée';
    else
      -- j'avais refusé sa demande ; maintenant c'est moi qui demande
      delete from private.friendships where requester = target and addressee = uid;
    end if;
  end if;

  if (select count(*) from private.friendships where requester = uid and status <> 'accepted') >= 30 then
    raise exception 'Trop de demandes en attente : annules-en quelques-unes.';
  end if;
  insert into private.friendships (requester, addressee, code_used) values (uid, target, c);
  return 'envoyée';
end $$;

-- Répondre à une demande reçue.
create function public.respond_friend(p_user uuid, p_accept boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  update private.friendships
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
  where requester = p_user and addressee = uid and status = 'pending';
  if not found then
    raise exception 'Demande introuvable (déjà traitée ?).';
  end if;
end $$;

-- Retirer un ami, ou annuler une demande que j'ai envoyée.
-- Une demande refusée ne s'efface qu'après 48 h (sinon l'effacer permettrait de relancer tout de suite).
create function public.remove_friend(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  delete from private.friendships
  where ((requester = uid and addressee = p_user) or (requester = p_user and addressee = uid))
    and (status = 'accepted'
         or (status = 'pending' and requester = uid)
         or (status = 'declined' and requester = uid and responded_at <= now() - interval '48 hours'));
end $$;

-- Mes amis et mes demandes. state : 'ami', 'reçue', 'envoyée' ou 'refusée' (par l'autre ;
-- retry_at = heure à partir de laquelle je peux relancer). Pour une demande envoyée ou refusée,
-- pas de pseudo : seulement le code tapé.
create function public.my_friends()
returns table (user_id uuid, state text, pseudo text, country text, code text, since timestamptz, retry_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select private.require_user() as uid)
  select
    case when f.requester = me.uid then f.addressee else f.requester end,
    case when f.status = 'accepted' then 'ami' when f.status = 'declined' then 'refusée'
         when f.requester = me.uid then 'envoyée' else 'reçue' end,
    case when f.status = 'accepted' or f.requester <> me.uid then p.pseudo end,
    case when f.status = 'accepted' or f.requester <> me.uid then p.country end,
    case when f.status <> 'accepted' and f.requester = me.uid then f.code_used end,
    coalesce(f.responded_at, f.created_at),
    case when f.status = 'declined' then f.responded_at + interval '48 hours' end
  from private.friendships f
  cross join me
  left join public.profiles p on p.id = case when f.requester = me.uid then f.addressee else f.requester end
  where me.uid in (f.requester, f.addressee)
    and not (f.addressee = me.uid and f.status = 'declined')   -- les refus faits par moi disparaissent
  order by 2, 3
$$;

-- Classement entre amis (moi + amis acceptés) ; p_month comme pour leaderboard.
create function public.friends_leaderboard(p_month date default null)
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
           count(s.id) filter (where s.valid)::bigint as captures
    from members m
    join public.profiles p on p.id = m.id
    left join private.scored_captures s
      on s.user_id = p.id
     and (p_month is null or (s.taken_at >= date_trunc('month', p_month::timestamp) at time zone 'UTC'
                          and s.taken_at < (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'UTC'))
    group by p.id, p.pseudo, p.country
  )
  select rank() over (order by t.points desc), t.pseudo, t.country, t.points, t.captures, t.id = (select uid from me)
  from totals t
  order by 1, 2
$$;

revoke all on function public.my_friend_code(), public.request_friend(text),
  public.respond_friend(uuid, boolean), public.remove_friend(uuid), public.my_friends(),
  public.friends_leaderboard(date) from public, anon;
grant execute on function public.my_friend_code(), public.request_friend(text),
  public.respond_friend(uuid, boolean), public.remove_friend(uuid), public.my_friends(),
  public.friends_leaderboard(date) to authenticated;
