-- Anti-triche « photo d'écran » : deux mesures de plus par capture (voir web/screen.js).
--   moire         : pic du spectre en dB au-dessus du fond, sur un carré de 128 px au centre de l'avion
--   screen_object : confiance d'un écran (télé, portable, téléphone) détecté autour de l'avion
-- Comme les autres mesures, elles sont figées après l'envoi.

alter table public.captures
  add column moire real,
  add column screen_object real check (screen_object is null or screen_object between 0 and 1);

create or replace function public.captures_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.user_id, new.client_id, new.taken_at, new.uploaded_at,
      new.latitude, new.longitude, new.accuracy_m, new.gps_age_s,
      new.width, new.height, new.confidence, new.size_ratio, new.sharpness, new.brightness,
      new.moire, new.screen_object,
      new.box, new.thresholds, new.valid, new.reasons, new.user_agent)
     is distinct from
     (old.id, old.user_id, old.client_id, old.taken_at, old.uploaded_at,
      old.latitude, old.longitude, old.accuracy_m, old.gps_age_s,
      old.width, old.height, old.confidence, old.size_ratio, old.sharpness, old.brightness,
      old.moire, old.screen_object,
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
