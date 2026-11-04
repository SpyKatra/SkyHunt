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
| Catalogue de 69 types, 5 raretés, aéroports de référence | `web/catalog.js` |
| Points, niveaux, 12 succès, statistiques | `web/game.js` |
| Écrans : Chasser, Cartes (cartes / album / refusées), Carte (Leaflet + OSM), Profil | `web/ui-*.js` |
| Compte (code à 6 chiffres par courriel), profil pseudo + pays ISO, synchro des captures, suppression du compte | `web/cloud.js`, `web/cloud-config.js`, `web/ui-profile.js` |
| Serveur : tables, RLS, mesures figées, photos privées | `supabase/migrations/`, `supabase/README.md` |
| **App native 0.5** (Expo) : tous les écrans du web + zoom optique, vraie photo, OCR Apple Vision / ML Kit, même compte Supabase. Pas encore compilée sur un téléphone | `native/` (voir `native/README.md`) |

### Règle de points (document de projet)

`Score = (P_appareil + P_lieu) × Q × R + Bonus`
- P_appareil : Commun 2, Peu commun 5, Rare 10, Épique 20, Légendaire 30.
- P_lieu : **1 point fixe pour l'instant** (la rareté locale viendra avec le serveur).
- Q = 1,2 si photo excellente (confiance ≥ 0,8 et taille ≥ 0,4), sinon 1.
- R selon le nombre de captures précédentes du même type : 1 ; 0,5 ; 0,25 ; puis 0,1.
- Bonus +5 pour un nouveau type. Même immatriculation déjà capturée = 0 point.
- Les points sont **recalculés** à chaque chargement (`recomputeAll`) : ne pas les stocker comme vérité.

## Décisions et contraintes à respecter

- **Pas de photo depuis la galerie**, jamais : c'est la base de l'anti-triche.
- **Aucune donnée de propriétaire** du registre canadien dans le dépôt ou l'app (vie privée).
  `tools/build_registre.py` ne garde que marque, constructeur, modèle, type.
- Le registre canadien est **très dense** (≈ 30 600 marques sur ≈ 35 000 possibles) : une marque mal lue
  tombe presque toujours sur un autre avion existant. Ne corriger que les confusions « forcées »
  (1ʳᵉ lettre E→F, chiffres→lettres) et **toujours faire confirmer le joueur**.
- Vols militaires : prévoir un avertissement à accepter avant la photo (voir le document de projet) ;
  certains pays interdisent ces photos. Ne jamais encourager l'entrée en zone réglementée.
- Spy est autorisé à photographier depuis une cour privée côté piste : ne pas bloquer ces zones
  par défaut ; prévoir plus tard un statut « accès autorisé ».
- Serveur : les points ne sont **jamais stockés** ; les mesures d'une capture sont figées après l'envoi (déclencheur),
  seule l'identification change. Photo envoyée seulement pour les captures valides.
  Toute modification du schéma = **nouvelle** migration dans `supabase/migrations/` (ne pas réécrire l'ancienne).
- Monétisation sans « pay-to-win » : aucun achat ne doit rapporter de points.
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
  `web/data/registre-ca.json`. Les journaux listent les gros appareils non reliés au catalogue :
  s'en servir pour ajouter des règles dans `tools/build_registre.py` et des types dans `web/catalog.js`.

## Feuille de route (vers une vraie app)

1. **Serveur et comptes** : Supabase (PostgreSQL + PostGIS, Auth avec Apple / Google / courriel, Storage).
   Envoyer les captures, garder un cache local. ← **fait** (2026-11-03). Courriels : SMTP Gmail de Spy
   (≈ 500/jour, suffisant pour 5-6 joueurs en développement) ; passer à Resend + nom de domaine avant la bêta.
   Les captures envoyées sont recompressées (JPEG 80 %, 1920 px) ; l'original reste sur le téléphone.
2. **Classements** : mondial, national (pays du compte), mensuel, amis ; rareté des lieux calculée
   à partir des captures (remplace P_lieu = 1).
3. **Passage en natif** : ← **en cours** (décidé le 2026-11-03 : Expo plutôt que Capacitor, pour le zoom optique,
   la vraie photo et l'OCR natif ; iPhone + Android). Code 0.5 écrit et assemblé (`expo export`), pas encore compilé :
   il faut le compte Expo de Spy (`eas login`, `eas init`) et son compte Apple Developer (inscription en cours).
   Distribution : APK par lien pour Android, TestFlight pour iPhone.
   **Mise à jour d'Expo** (2026-11-04) : la SDK 56 (vision-camera 4) fermait l'app sur Android (aperçu noir puis
   plantage natif). Spy a demandé de passer directement à la SDK 58 + vision-camera 5 : branche `sdk-58`, à tester
   sur Android avant de la fusionner dans `main`.
4. **Anti-triche serveur** : (anti-écran sur le téléphone : fait le 2026-11-03) jeton de capture à usage unique, signature, App Attest / Play Integrity,
   pHash anti-doublons, plus tard recoupement ADS-B (licence commerciale à vérifier).
5. **IA de reconnaissance du type** quand l'immatriculation n'est pas lisible ; registre FAA (N-) en plus.
6. **Bêta fermée** (TestFlight, test fermé Play Store), 50 à 300 testeurs.
7. **Publication** : politique de confidentialité (Loi 25, LPRPDE, RGPD), conditions, fiches des boutiques.
