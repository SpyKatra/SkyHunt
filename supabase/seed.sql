-- Données de la base LOCALE seulement (supabase db reset) : jamais appliqué au projet en ligne.
-- La base locale appelle la fonction Edge locale (passerelle Kong du réseau Docker), pas celle en ligne.
update private.settings set value = 'http://kong:8000/functions/v1/photo-hash' where key = 'photo_hash_url';
