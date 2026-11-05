# SkyHunt — contexte pour Claude Code

Jeu mobile (iOS + Android) : on photographie de **vrais avions** pour les collectionner.
Chaque capture rapporte des points selon la rareté de l'appareil et du lieu, avec des classements
mondial et national (pays choisi à la création du compte).

- Porteur du projet : Spy (Québec, région de YQB). **Langue de travail : français** (interface, messages de commit, docs).
- Dossier de projet complet (concept, points, anti-triche, légal, feuille de route) :
  https://claude.ai/artifact/6EA6S2uTtjJNcucsHnRqbv (document privé de Spy).
- Version web en ligne : https://spykatra.github.io/SkyHunt/ (publiée par GitHub Actions à chaque push dans `web/` ;
  réglage Pages → Source = « GitHub Actions », sinon le README est publié à la place).

## État actuel : prototype 0.4 (novembre 2026)

Tout tourne **sur le téléphone** (IndexedDB, hors ligne possible). Avec un compte, les captures sont
envoyées sur Supabase et récupérées sur les autres appareils. Projet en ligne `jujomunxljjjrtetqvoe` (ca-central-1),
migration appliquée, testé par Spy sur iPhone le 2026-11-03 (voir `supabase/README.md`).

| Fonction | Où |
| --- | --- |
| Caméra intégrée seulement (pas d'import de galerie) | `web/app.js` |
| Détection d'avion EfficientDet-Lite0 (COCO, classe 4 = airplane) en WebAssembly, ~5 analyses/s | `web/detector.js`, `web/vendor/tflite/` |
| Validation : confiance ≥ 50 %, taille ≥ 15 %, netteté (variance du laplacien), luminosité | `web/validation.js`, `web/config.js` |
| **Anti-triche « photo d'écran »** : écran COCO (télé / portable / téléphone) autour de l'avion ≥ 40 %, ou moiré coloré ≥ 12 dB (FFT de la couleur sur 128 px à pleine résolution, médiane de 3 analyses). Partagé avec le natif (fonctions `'worklet'`) | `web/screen.js` |
| Lecture de l'immatriculation (Tesseract.js, binarisation d'Otsu, 2 passes) | `web/ocr.js`, `web/vendor/tesseract/` |
| Registre de Transport Canada : marque C-XXXX → modèle exact → type SkyHunt | `web/registry.js`, `web/data/registre-ca.json` |
| Catalogue : 239 **familles** (cartes, rareté) et 652 **séries** (737-800, 737-900ER, Cessna 172S…), de l'avion de ligne à l'ultraléger, 5 raretés, aéroports de référence. Séries reconnues dans le modèle exact du registre (`matchSeries`) ; sinon le joueur choisit la famille puis la série | `web/fleet.js`, `web/catalog.js` |
| Points, niveaux, 13 succès, statistiques | `web/game.js` |
| Écrans : Chasser, Cartes (cartes / album / refusées), Carte (Leaflet + OSM), Classement, Profil | `web/ui-*.js` |
| Classements mondial / national / du mois, points calculés par le serveur | `web/ui-ranks.js`, `native/src/RanksScreen.tsx`, `supabase/migrations/20261104120000_classements.sql` |
| Classement entre amis + gestion des amis dans le **Profil** (code ami fixe, demandes à accepter / refuser) | `web/ui-friends.js`, `native/src/FriendsSection.tsx`, `native/src/friends.ts`, `supabase/migrations/20261105120000_amis.sql` |
| Compte (code à 6 chiffres par courriel), profil pseudo + pays ISO **fixés à la création**, synchro des captures, suppression du compte | `web/cloud.js`, `web/cloud-config.js`, `web/ui-profile.js`, `supabase/migrations/20261105130000_profil_fige.sql` |
| Serveur : tables, RLS, mesures figées, photos privées | `supabase/migrations/`, `supabase/README.md` |
| **Anti-triche serveur** : jetons de capture à usage unique (sans jeton = compté à l'heure de réception), photos en double (empreinte calculée par la fonction Edge `photo-hash`, ressemblance ≥ 0,9 = 0 point) | `web/cloud.js`, `supabase/migrations/20261106120000_anti_triche.sql`, `supabase/functions/photo-hash/` |
| **Avertissement militaire** (avant qu'un type militaire compte) et consigne de sécurité au 1er lancement de la caméra ; listes de pays **provisoires** | `web/military.js`, `web/ui-identify.js`, `native/src/IdentifySheet.tsx` |
| Registre de la FAA (États-Unis) : marque N… → modèle → type, chargé au besoin | `web/registry.js`, `tools/build_registre_us.py`, `web/data/registre-us.json` |
| **App native 0.5** (Expo) : tous les écrans du web + zoom optique, vraie photo, OCR Apple Vision / ML Kit, même compte Supabase. APK Android testé par Spy (Samsung S23), mises à jour par `eas update`. **Analyse de la photo prise** (plus de détection en direct) | `native/` (voir `native/README.md`), `native/src/photoAnalysis.ts` |

### Règle de points (document de projet)

`Score = (P_appareil + P_lieu) × Q × R + Bonus`
- P_appareil : Commun 2, Peu commun 5, Rare 10, Épique 20, Légendaire 30.
- P_lieu : rareté du lieu, calculée par le serveur (`my_scores`) : captures valides de tous les joueurs à moins de 5 km
  faites avant celle-ci : aucune → 5, 1-9 → 3, 10-49 → 2, 50+ → 1. Gardée dans `placePoints` ; sans compte : 1.
- Q = 1,2 si photo excellente (confiance ≥ 0,8 et taille ≥ 0,4), sinon 1.
- R selon le nombre de captures précédentes du même type : 1 ; 0,5 ; 0,25 ; puis 0,1.
- Bonus +5 pour un nouveau type (famille). +2 pour une **nouvelle série** d'une famille déjà capturée (pas cumulé avec le +5 ;
  une série qui n'appartient pas à la famille est ignorée). Même immatriculation déjà capturée = 0 point.
- 0 point (et ne compte ni pour R ni pour le bonus) : photo en double d'une photo déjà envoyée (`duplicate`, vu par
  le serveur), appareil militaire sans avertissement accepté (`militaryAckAt`). Voir `blockReason` dans `web/game.js`.
- Les points sont **recalculés** à chaque chargement (`recomputeAll`) : ne pas les stocker comme vérité.
  Le serveur refait le même calcul pour les classements (`private.scored_captures`) : toute modification des règles
  de `web/game.js` doit être reportée dans une nouvelle migration (`tests/leaderboard.js` compare les deux).

## Décisions et contraintes à respecter

- **Analyse après la photo** (décision de Spy, 2026-11-05) : l'app native n'analyse plus le flux vidéo en direct. Sur Samsung S23, ce flux (1440×1080, « binning ») arrivait à l'envers au modèle (Resizer : « left » tourné de 270° au lieu de 90°), contenait un faux motif de couleur de 4 px (pics de moiré toujours en (±32, 32)) et ne montrait pas la trame des écrans. La photo prise est analysée (`photoAnalysis.ts` : modèle sur 320×320, moiré sur 3 carrés de 128 px à pleine résolution, médiane), le verdict s'affiche tout de suite et la caméra reste ouverte. Seuil du moiré sur photo **à recalibrer** avec de vraies mesures. `useAircraftDetector.ts`, vision-camera-resizer et le frame processor sont à retirer à la prochaine version compilée.

- **Familles et séries** (décision de Spy, 2026-11-04) : la carte, la rareté et le +5 restent par famille ; chaque série
  a un identifiant `famille.clé` (ex. `b737-800.900er`) **à ne jamais renommer** (enregistré dans les captures). Après un
  ajout dans `web/fleet.js` : nouvelle migration générée par `tools/sql_catalogue.mjs`.

- **Pas de photo depuis la galerie**, jamais : c'est la base de l'anti-triche.
- **Aucune donnée de propriétaire** des registres canadien et américain dans le dépôt ou l'app (vie privée).
  `tools/build_registre.py` et `tools/build_registre_us.py` ne gardent que marque, constructeur, modèle, type.
  Avions de construction amateur et ultralégers : le « constructeur » est souvent le nom du particulier, il n'est
  **jamais gardé** (`anonymize` : constructeur de la famille de `web/fleet.js` ou « Construction amateur » /
  « Ultraléger » ; modèle gardé seulement si relié à une famille et partagé par au moins 2 avions).
  Le registre FAA (≈ 60 Mo, noms et adresses) n'est téléchargé que par GitHub Actions, jamais enregistré.
- Le registre canadien est **très dense** (≈ 30 600 marques sur ≈ 35 000 possibles) : une marque mal lue
  tombe presque toujours sur un autre avion existant. Ne corriger que les confusions « forcées »
  (1ʳᵉ lettre E→F, chiffres→lettres) et **toujours faire confirmer le joueur**.
- Vols militaires : avertissement à accepter quand le joueur choisit un type militaire (le détecteur ne sait pas
  distinguer un avion militaire) : une fois par session (pays sans restriction), à chaque photo (pays restreint ou
  inconnu), capture militaire impossible (pays interdit). Pays : position de la photo (natif), sinon pays du profil.
  Les listes de `web/military.js` sont **provisoires : à faire valider par un juriste avant la publication**.
  Pas encore de zone de 1 km autour des bases (il faut une source de données). Ne jamais encourager l'entrée en zone réglementée.
- Spy est autorisé à photographier depuis une cour privée côté piste : ne pas bloquer ces zones
  par défaut ; prévoir plus tard un statut « accès autorisé ».
- Serveur : les points ne sont **jamais stockés** ; les mesures d'une capture sont figées après l'envoi (déclencheur),
  seule l'identification change. Photo envoyée seulement pour les captures valides.
  Toute modification du schéma = **nouvelle** migration dans `supabase/migrations/` (ne pas réécrire l'ancienne).
- Monétisation sans « pay-to-win » : aucun achat ne doit rapporter de points.
- **Pseudo et pays** : choisis une seule fois, à la création du compte (décision de Spy, 2026-11-04). Le joueur ne peut
  plus les modifier (pas de droit UPDATE sur `profiles`) ; changement = demande au support, fait à la main par un
  administrateur / modérateur (tableau de bord Supabase).
- **Amis** (décisions de Spy, 2026-11-04) : un **code ami fixe** par compte (8 caractères, pas de changement de code) ;
  entrer un code envoie une **demande** que l'autre accepte ou refuse (rien ne compte avant l'acceptation, pas de pseudo
  visible avant) ; une demande refusée ne peut être **relancée par la même personne qu'après 48 h** (l'expéditeur voit
  « refusée » et le délai) ; au plus 20 codes essayés par heure. La gestion des amis est dans le **Profil** (pastille
  sur l'onglet Profil), le classement entre amis dans Classement.
- Natif : les règles du jeu ne sont **pas recopiées** : `native/src/shared.ts` importe `web/catalog.js`, `game.js`,
  `registry.js`, `validation.js`, `config.js` et `cloud-config.js` (Metro `watchFolders`). Ces fichiers doivent rester
  sans DOM. Le registre est embarqué dans l'app et rafraîchi depuis GitHub Pages.
- Natif : versions **épinglées** dans `native/` (branche `sdk-58`, décidé par Spy le 2026-11-04 après des fermetures
  de l'app sur Android en SDK 56) : Expo SDK 58, RN 0.88, vision-camera 5.2.4 (+ -worklets, -resizer 5.2.4),
  react-native-worklets 0.13.0, nitro-modules 0.37.2, nitro-image 0.15.2, fast-tflite 3.0.1.
  Pas de mise à jour sans tester sur un vrai téléphone. Frame processor = `useFrameOutput({ onFrame })` :
  appeler `frame.dispose()`, état entre images dans `globalThis` du worklet, retour à JS par `scheduleOnRN`.
- Natif : le shader Vulkan du resizer est compilé sur EAS par `native/scripts/compile-resizer-shader.js`
  (`eas-build-post-install`) car AGP 9 ne compile plus `src/main/shaders` ; ne pas retirer ce script.
- Natif : **ne pas lier la caméra à `AppState`** : sur Android, l'ouverture de la caméra fait passer l'app un instant en
  « background » → boucle de redémarrages (écran noir, lag, fermetures ; vu au logcat le 2026-11-04). Sur Android, prendre
  la caméra arrière par défaut (pas de filtre `physicalDevices`). Débogage : adb sans fil (voir `native/README.md`).
- Natif : changement de code seulement → `npx eas-cli update --channel preview --environment preview` (expo-updates, 2-3 min) au lieu
  d'un APK. Changement natif → augmenter `version` dans `native/app.json` (= runtimeVersion) **et** recompiler.
- Safari iOS : la caméra exige HTTPS (Pages) ou localhost. Changer `?v=` dans `web/index.html`
  quand `app.js` ou `style.css` change, sinon Safari garde l'ancienne version en cache.

## Tester

```bash
cd tests && npm install && npx playwright install chromium   # une fois
cd web && python3 -m http.server 8766          # terminal 1
python3 tests/make_video.py                    # crée tests/cam.y4m (Pillow + ffmpeg ou imageio-ffmpeg)
node tests/e2e.js                              # terminal 2 (Playwright + Chromium)
npx supabase@3.0.0 start                       # serveur local (Docker), puis :
node tests/cloud.js                            # règles du serveur
node tests/leaderboard.js                      # classements, points serveur = web/game.js
node tests/friends.js                          # amis : demandes, refus et relance 48 h, limite d'essais
node tests/anti-triche.js                      # jetons, captures antidatées, militaire, photos en double
node tests/e2e-cloud.js                        # compte + synchro entre 2 « téléphones »
```

`tests/e2e.js` utilise une fausse caméra (avion dessiné : loin → proche avec « C-FJEP » → flou → le même
avion sur un écran) et vérifie : refus « trop loin », lecture C-FJEP → Saab 340B, révélation +12 pts,
capture répétée à 0 pt, refus « photo d'écran », cartes, album, carte du monde, profil. Captures d'écran dans `tests/shots/`.
Le vrai test reste Spy sur son iPhone : il colle le CSV du bouton « Copier les mesures ».

### Seuils à calibrer

Première vraie photo (Saab 340 à YQB, iPhone) : confiance 0,82, taille 0,82, **netteté 5230**,
luminosité 167. Le seuil de netteté (60) est donc beaucoup trop bas ; il faut des photos floues,
lointaines et en contre-jour pour le régler.

**Moiré (anti-écran)** : réglé sur simulation (photos réelles ≤ 9,2 dB, avion filmé ≤ 10 dB, écrans nets
de près 14 à 30 dB ; écrans de loin ou flous non détectés). Seuil 12 dB. Il faut des vraies mesures :
de vrais avions (surtout de près, hublots nets) et des avions sur écran d'ordinateur / téléphone.
La luminance n'est **pas** utilisée : une rangée de hublots nets y crée des pics comme un écran.
La vidéo de test passe par un faux « capteur » (flou + bruit) : une image dessinée brute ressemble à un écran.

## Automatisations GitHub

- `.github/workflows/pages.yml` : publie `web/` sur GitHub Pages.
- `.github/workflows/registre.yml` : chaque lundi, télécharge le registre de Transport Canada
  (`ccarcsdb.zip`, colonnes : 0 marque, 3 constructeur, 4 modèle, 10 catégorie, 19 masse) et régénère
  `web/data/registre-ca.json` ; idem pour la FAA (`ReleasableAircraft.zip` : `MASTER.txt` + `ACFTREF.txt`)
  → `web/data/registre-us.json` (pas embarqué dans l'app native : téléchargé au besoin). Relance ensuite Pages. Les journaux listent les gros appareils non reliés au catalogue :
  s'en servir pour ajouter des règles dans `tools/build_registre.py` et des types dans `web/catalog.js`.

## Feuille de route (vers une vraie app)

1. **Serveur et comptes** : Supabase (PostgreSQL + PostGIS, Auth avec Apple / Google / courriel, Storage).
   Envoyer les captures, garder un cache local. ← **fait** (2026-11-03). Courriels : SMTP Gmail de Spy
   (≈ 500/jour, suffisant pour 5-6 joueurs en développement) ; passer à Resend + nom de domaine avant la bêta.
   Les captures envoyées sont recompressées (JPEG 80 %, 1920 px) ; l'original reste sur le téléphone.
2. **Classements** : mondial, national (pays du compte), mensuel, rareté des lieux ← **fait** (2026-11-04,
   migration appliquée en ligne) ; classement entre amis par code ami ← **fait** (2026-11-04, migrations
   `20261105120000_amis.sql` et `20261105130000_profil_fige.sql` à appliquer sur le projet en ligne).
3. **Passage en natif** : ← **en cours** (décidé le 2026-11-03 : Expo plutôt que Capacitor, pour le zoom optique,
   la vraie photo et l'OCR natif ; iPhone + Android). Code 0.5 écrit et assemblé (`expo export`), pas encore compilé :
   il faut le compte Expo de Spy (`eas login`, `eas init`) et son compte Apple Developer (inscription en cours).
   Distribution : APK par lien pour Android, TestFlight pour iPhone.
   **Mise à jour d'Expo** (2026-11-04) : la SDK 56 (vision-camera 4) fermait l'app sur Android (aperçu noir puis
   plantage natif). Spy a demandé de passer directement à la SDK 58 + vision-camera 5 : branche `sdk-58`, à tester
   sur Android avant de la fusionner dans `main`.
4. **Anti-triche serveur** : (anti-écran sur le téléphone : fait le 2026-11-03) jeton de capture à usage unique et
   empreinte anti-doublons ← **faits** (2026-11-04, migration `20261106120000_anti_triche.sql` + fonction Edge
   `photo-hash` à mettre en ligne) ; reste : signature, App Attest / Play Integrity, plus tard recoupement ADS-B
   (licence commerciale à vérifier).
5. **IA de reconnaissance du type** quand l'immatriculation n'est pas lisible ; registre FAA (N-) ← **fait** (2026-11-04).
6. **Bêta fermée** (TestFlight, test fermé Play Store), 50 à 300 testeurs.
   Avant la bêta : choisir l'adresse du support (affichée près du pseudo et du pays figés, « contacte le support »).
7. **Publication** : politique de confidentialité (Loi 25, LPRPDE, RGPD), conditions, fiches des boutiques.
