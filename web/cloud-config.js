// Connexion au serveur Supabase (étape 1 de la feuille de route).
// Les deux valeurs viennent du tableau de bord Supabase → Project Settings → API.
// La clé « publishable » (sb_publishable_…) est faite pour être publique : la sécurité
// repose sur les règles RLS de supabase/migrations. Ne JAMAIS mettre ici la clé secrète.
// Laisser vide = l'app fonctionne comme avant, sans compte, tout sur le téléphone.
export const SUPABASE_URL = 'https://jujomunxljjjrtetqvoe.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_pwM2rTNm3lTGLAtl8SAUEA_UI3HMr7G';
