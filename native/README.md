# SkyHunt — Prototype natif 0.1

Premier prototype du jeu : **caméra intégrée + détection d'avion en direct + validation de la photo + carnet local**.

Objectif de cette étape : vérifier sur le terrain (YQB, YUL) que la détection est fiable et régler les seuils
avant d'attaquer l'identification du type d'avion, les comptes et les classements.

## Ce que fait le prototype

| Fonction | Détail |
| --- | --- |
| Caméra intégrée | Seule source de photos (pas d'import depuis la galerie) |
| Détection en direct | Modèle EfficientDet-Lite0 (COCO, classe « avion »), ~5 analyses/s, sur le téléphone |
| Cadre sur l'avion | Vert = photo valide, orange = refusée |
| Validation | Confiance ≥ 50 %, taille ≥ 15 % de l'image, netteté, luminosité |
| Conseils en direct | « Trop loin », « Image floue », « Trop sombre »… |
| Capture | Photo + GPS + heure + mesures, enregistrées dans l'app |
| Anti-triche (début) | Pas de galerie ; position fictive détectée sur Android → 0 point |
| Collection | Liste des captures, points, raisons de refus (appui long = supprimer) |
| Diagnostic | Valeurs mesurées à l'écran pour régler les seuils |

Pas encore inclus : identification du type (A320, 737…), serveur, comptes, classements, ADS-B.
Chaque capture valide vaut 2 points provisoires.

## Installation (une seule fois)

Prérequis : [Node.js 22](https://nodejs.org) et un compte gratuit sur [expo.dev](https://expo.dev).

```bash
cd native
npm install
npm install -g eas-cli
eas login
eas init          # relie le projet à ton compte Expo
```

> **Expo Go ne fonctionne pas** pour ce projet : la caméra et l'IA utilisent du code natif.
> Il faut un « development build », compilé dans le nuage par EAS (pas besoin de Mac).

### Sur iPhone

Il faut un compte **Apple Developer** (99 $ US / an).

```bash
eas device:create                                   # enregistre ton iPhone (QR code à scanner)
eas build --profile development --platform ios
```

Quand la compilation est finie (~15 min), ouvre le lien sur ton iPhone pour installer l'app.
Active ensuite **Réglages → Confidentialité et sécurité → Mode développeur**, puis redémarre.

### Sur Android

```bash
eas build --profile development --platform android
```

Ouvre le lien sur le téléphone et installe l'APK.

## Lancer l'app

Sur ton ordinateur (même Wi-Fi que le téléphone) :

```bash
npx expo start --dev-client
```

Ouvre SkyHunt sur le téléphone et scanne le QR code. Les modifications du code s'affichent ensuite
sans recompiler, sauf si on ajoute une bibliothèque native.

## Protocole de test terrain (à faire à YQB)

Depuis une **zone publique** (stationnement, belvédère), pas côté piste.

1. Laisse le panneau **Diagnostic** ouvert.
2. Prends ~20 photos variées : avion proche au sol, avion au décollage, avion loin dans le ciel,
   photo volontairement floue, contre-jour.
3. Pour chaque cas, note ce qu'affiche le diagnostic : confiance, taille, netteté, luminosité.
4. Si le cadre vert ne suit pas l'avion (décalé ou tourné), appuie sur **↻ Orientation** jusqu'à ce qu'il
   tombe juste, et note l'angle.
5. Envoie-moi les valeurs (ou une capture d'écran de la Collection) : je règle les seuils dans
   `src/config.ts`.

Critère pour passer à l'étape suivante : l'avion est détecté sur au moins 85 % des photos où il est
clairement visible, et les photos « point dans le ciel » sont bien refusées.

## Structure

```
App.tsx                     onglets Chasser / Collection
src/config.ts               seuils de validation (à régler)
src/useAircraftDetector.ts  analyse des images de la caméra (modèle + netteté)
src/validation.ts           règles et messages au joueur
src/CameraScreen.tsx        écran caméra, cadre, diagnostic, déclencheur
src/CollectionScreen.tsx    carnet des captures
src/storage.ts              enregistrement local des photos et du carnet
assets/models/              modèle EfficientDet-Lite0 (.tflite)
```

## Versions figées

Expo SDK 56 (React Native 0.85), react-native-vision-camera 4.7.3, react-native-worklets-core 1.6.3,
vision-camera-resize-plugin 3.2.0, react-native-fast-tflite 3.0.1, react-native-nitro-modules 0.37.1.
Cette combinaison est celle testée par la bibliothèque de détection ; ne pas mettre à jour une seule
de ces dépendances sans les autres.
