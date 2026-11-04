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
| Lecture de l'immatriculation (Tesseract.js, binarisation d'Otsu, 2 passes) | `web/ocr.js`, `web/vendor/tesseract/` |
| Registre de Transport Canada : marque C-XXXX → modèle exact → type SkyHunt | `web/registry.js`, `web/data/registre-ca.json` |
| Catalogue de 69 types, 5 raretés, aéroports de référence | `web/catalog.js` |
| Points, niveaux, 12 succès, statistiques | `web/game.js` |
| Écrans : Chasser, Cartes (cartes / album / refusées), Carte (Leaflet + OSM), Profil | `web/ui-*.js` |
| Compte (code à 6 chiffres par courriel), profil pseudo + pays ISO, synchro des captures, suppression du compte | `web/cloud.js`, `web/cloud-config.js`, `web/ui-profile.js` |
| Serveur : tables, RLS, mesures figées, photos privées | `supabase/migrations/`, `supabase/README.md` |
| Prototype natif Expo (caméra + détection, même logique, pas encore les cartes/profil/OCR) | `native/` |

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
- Natif : versions **figées** dans `native/` (Expo SDK 56, RN 0.85, vision-camera 4.7.3,
  worklets-core 1.6.3, resize-plugin 3.2.0, fast-tflite 3.0.1, nitro-modules 0.37.1).
  Ne pas mettre à jour une seule de ces dépendances. Dans les frame processors, **pas de sous-worklet**
  qui capture un objet natif (le plugin Babel détache `unbox` / `runSync`).
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

`tests/e2e.js` utilise une fausse caméra (avion dessiné : loin → proche avec « C-FJEP » → flou) et
vérifie : refus « trop loin », lecture C-FJEP → Saab 340B, révélation +12 pts, capture répétée à 0 pt,
cartes, album, carte du monde, profil. Captures d'écran dans `tests/shots/`.
Le vrai test reste Spy sur son iPhone : il colle le CSV du bouton « Copier les mesures ».

### Seuils à calibrer

Première vraie photo (Saab 340 à YQB, iPhone) : confiance 0,82, taille 0,82, **netteté 5230**,
luminosité 167. Le seuil de netteté (60) est donc beaucoup trop bas ; il faut des photos floues,
lointaines et en contre-jour pour le régler.

## Automatisations GitHub

- `.github/workflows/pages.yml` : publie `web/` sur GitHub Pages.
- `.github/workflows/registre.yml` : chaque lundi, télécharge le registre de Transport Canada
  (`ccarcsdb.zip`, colonnes : 0 marque, 3 constructeur, 4 modèle, 10 catégorie, 19 masse) et régénère
  `web/data/registre-ca.json`. Les journaux listent les gros appareils non reliés au catalogue :
  s'en servir pour ajouter des règles dans `tools/build_registre.py` et des types dans `web/catalog.js`.

## Feuille de route (vers une vraie app)

1. **Serveur et comptes** : Supabase (PostgreSQL + PostGIS, Auth avec Apple / Google / courriel, Storage).
   Envoyer les captures, garder un cache local. ← **fait**, sauf le SMTP perso : sans lui, Supabase n'envoie
   qu'un **lien** (pas le code à 6 chiffres), seulement à Spy, ~2 courriels/h ; le lien ne connecte que dans Safari,
   pas dans l'app de l'écran d'accueil. À brancher (Resend ou Gmail) puis mettre `supabase/templates/code.html`.
2. **Classements** : mondial, national (pays du compte), mensuel, amis ; rareté des lieux calculée
   à partir des captures (remplace P_lieu = 1).
3. **Passage en natif** : porter les fonctions web dans `native/`, compte Apple Developer, EAS Build.
4. **Anti-triche serveur** : jeton de capture à usage unique, signature, App Attest / Play Integrity,
   pHash anti-doublons, plus tard recoupement ADS-B (licence commerciale à vérifier).
5. **IA de reconnaissance du type** quand l'immatriculation n'est pas lisible ; registre FAA (N-) en plus.
6. **Bêta fermée** (TestFlight, test fermé Play Store), 50 à 300 testeurs.
7. **Publication** : politique de confidentialité (Loi 25, LPRPDE, RGPD), conditions, fiches des boutiques.
