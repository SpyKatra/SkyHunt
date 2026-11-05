-- SkyHunt — pseudo et pays fixés à la création du compte (décision de Spy, 2026-11-04).
--
-- Un joueur crée son profil une seule fois et ne peut plus le modifier lui-même.
-- Changement de pseudo ou de pays : demande au support, fait à la main par un administrateur
-- ou un modérateur (tableau de bord Supabase ou SQL, qui ne sont pas soumis à ces règles), par exemple :
--   update public.profiles set pseudo = 'NouveauPseudo' where id = '<id du joueur>';

drop policy "profil : modification du sien" on public.profiles;
revoke update on public.profiles from authenticated;

comment on table public.profiles is
  'Un profil par compte : pseudo (unique) et pays du classement national. Fixés à la création ; modifiables seulement par un administrateur.';
