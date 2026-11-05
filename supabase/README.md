# Serveur SkyHunt (Supabase)

Étape 1 de la feuille de route : comptes et sauvegarde des captures.

| Fichier | Rôle |
| --- | --- |
| `migrations/20261103000000_comptes_et_captures.sql` | Tables `profiles` et `captures`, règles RLS, mesures figées, suppression du compte, compartiment photo `captures` |
| `migrations/20261104000000_anti_ecran.sql` | Mesures anti-triche « photo d'écran » (`moire`, `screen_object`), figées comme les autres |
| `migrations/20261104120000_classements.sql` | Classements (`leaderboard`), points recalculés par le serveur (`my_scores`), rareté des lieux, copie du catalogue (`aircraft_types`, `rarities`) |
| `templates/code.html` | Courriel « Ton code SkyHunt » (code à 6 chiffres) |
| `config.toml` | Configuration de l'instance locale (`npx supabase start`) |

## Ce qui est stocké

- **profiles** : pseudo (unique, sans tenir compte des majuscules), pays (code ISO : `CA`, `FR`…).
- **captures** : heure, position (+ colonne PostGIS `position`), mesures de détection, validité, raisons de refus,
  type, immatriculation. **Pas de points** : ils se recalculent. Après l'envoi, seule l'identification
  (type, immatriculation) peut changer ; les mesures et la photo sont figées par un déclencheur.
- **Photos** : compartiment privé `captures`, chemin `<id du compte>/<id local>.jpg`, JPEG ≤ 6 Mo,
  impossibles à remplacer. Seules les captures **valides** envoient leur photo.
- Chaque joueur ne lit et n'écrit que ses propres données. Rien n'est lisible sans compte.

## Classements (étape 2)

- `leaderboard(p_country, p_month, p_limit)` : mondial (`p_country` nul), national (code ISO), du mois (`p_month` = une date
  du mois, UTC). Renvoie rang, pseudo, pays, points, nombre de cartes et la ligne du joueur connecté. Rien d'autre
  (ni position, ni capture) n'est visible des autres joueurs ; il faut un compte.
- `my_scores()` : points de lieu et points de chacune de mes captures, calculés par le serveur.
- Les points sont calculés par la vue `private.scored_captures` (schéma inaccessible à l'API) avec les règles de
  `web/game.js` ; `tests/leaderboard.js` vérifie que serveur et app donnent les mêmes points.
- **Points de lieu** : captures valides de tous les joueurs à moins de 5 km, faites avant celle-ci :
  aucune → 5, 1 à 9 → 3, 10 à 49 → 2, 50 et plus → 1.
- **Catalogue** : le serveur a sa copie des raretés. Après un ajout dans `web/catalog.js` :
  `node tools/sql_catalogue.mjs > supabase/migrations/<date>_catalogue.sql` (nouvelle migration).

## Mise en ligne (à faire par Spy, une fois)

1. Créer un compte sur <https://supabase.com> puis un projet **skyhunt**, région **Canada (Central)**
   (`ca-central-1`, données au Canada : plus simple pour la Loi 25). Noter le mot de passe de la base.
2. Appliquer les migrations **dans l'ordre**, au choix :
   - **SQL Editor** du tableau de bord : coller le contenu du fichier de migration, puis *Run* ;
   - ou en ligne de commande, depuis la racine du dépôt :
     ```bash
     npx supabase@3.0.0 login
     npx supabase@3.0.0 link --project-ref <ref du projet>
     npx supabase@3.0.0 db push
     ```
3. **Authentication → Sign In / Providers → Email** : activé ; « Confirm email » peut rester activé.
4. **Authentication → Emails → Templates** : dans « Magic Link » **et** « Confirm signup », mettre le sujet
   `Ton code SkyHunt` et le contenu de `templates/code.html` (il faut `{{ .Token }}` : sans lui, le courriel
   contient un lien au lieu du code, et un lien ouvre Safari au lieu de l'app sur l'écran d'accueil).
5. **Authentication → URL Configuration** : Site URL = `https://spykatra.github.io/SkyHunt/`.
6. **Project Settings → API Keys** : copier l'URL du projet et la clé **publishable** (`sb_publishable_…`)
   dans `web/cloud-config.js`. Jamais la clé secrète.
7. Pousser : GitHub Pages republie l'app ; la section « Compte » apparaît dans Profil.

### Courriels : configuration actuelle

SMTP Gmail (mot de passe d'application Google, `smtp.gmail.com:465`), expéditeur « SkyHunt », code à 6 chiffres
(*Email OTP Length* = 6). Le même modèle `templates/code.html` est dans **Magic link or OTP** et **Confirm signup**.

- Copier le modèle sous Windows : `Get-Content supabase/templates/code.html -Raw -Encoding UTF8 | Set-Clipboard`
  (sans `-Encoding UTF8`, Windows PowerShell abîme les accents ; le modèle n'en contient d'ailleurs plus : entités HTML).
- Après un changement de modèle, Supabase met **quelques minutes** à l'appliquer : les courriels envoyés juste après
  utilisent encore l'ancienne version.

### Courriels : limite importante

Le serveur de courriel fourni par Supabase n'envoie qu'environ **2 courriels par heure** et seulement aux
adresses des membres de l'organisation Supabase. Suffisant pour les tests de Spy, **pas pour la bêta** :
avant d'inviter des testeurs, brancher un SMTP (Resend, Postmark, Amazon SES…) dans
*Authentication → Emails → SMTP Settings*.

### Plus tard

- Connexion Apple / Google : demande le compte Apple Developer et un projet Google Cloud (étape 3).
- Offre gratuite : 1 Go de photos (~1 000 à 2 000 captures) ; projet mis en pause après 7 jours sans activité.

## Tester en local (Docker)

```bash
npx supabase@3.0.0 start          # à la racine ; Mailpit (courriels reçus) sur http://127.0.0.1:54324
cd tests && npm install && npx playwright install chromium
node tests/cloud.js               # règles du serveur (31 contrôles)
node tests/leaderboard.js         # classements et points du serveur = web/game.js (27 contrôles)
node tests/e2e-cloud.js           # app + serveur : 2 « téléphones », synchro, suppression (web servi sur :8766)
```

Pour pointer l'app servie en local vers l'instance locale sans toucher `cloud-config.js`, dans la console :
`localStorage.setItem('skyhunt.cloud', JSON.stringify({ url: 'http://127.0.0.1:54321', key: '<PUBLISHABLE_KEY>' }))`.
