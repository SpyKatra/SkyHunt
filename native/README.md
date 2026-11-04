# SkyHunt — app native 0.5 (iOS et Android)

La vraie app, avec Expo / React Native. Même jeu, même serveur et même compte que la version web.

## Ce que fait l'app

| Fonction | Détail | Fichier |
| --- | --- | --- |
| Caméra intégrée | Seule source de photos (pas de galerie, permission bloquée sur Android) | `src/CameraScreen.tsx` |
| **Zoom optique** | Boutons 0,5× / 1× / 2× / 3× / 5× / 10× selon le téléphone, et pincement ; passe tout seul sur le téléobjectif | `src/CameraScreen.tsx` |
| Détection en direct | EfficientDet-Lite0, ~5 analyses/s, cadre vert/orange | `src/useAircraftDetector.ts` |
| Vraie photo | Pleine résolution, même proportion 4:3 que l'analyse | `src/CameraScreen.tsx` |
| Anti-triche « photo d'écran » | Écran détecté autour de l'avion ou moiré coloré (`web/screen.js`, calculé dans le frame processor) | `src/useAircraftDetector.ts` |
| Lecture de l'immatriculation | Apple Vision (iPhone) / Google ML Kit (Android), puis registre de Transport Canada | `src/ocr.ts`, `src/IdentifySheet.tsx` |
| Cartes, album, refusées, détail | Comme sur le web | `src/CardsScreen.tsx`, `src/DetailSheet.tsx` |
| Révélation animée + vibrations | Points, niveau, succès | `src/RevealModal.tsx` |
| Carte du monde | Leaflet + OpenStreetMap (pas de clé Google) | `src/MapScreen.tsx` |
| Profil, compte, synchro | Code par courriel, pseudo, pays, sauvegarde Supabase, suppression du compte | `src/ProfileScreen.tsx`, `src/cloud.ts` |
| Hors ligne d'abord | Carnet local (`captures.json` + photos), envoi quand le réseau revient | `src/storage.ts` |

**Règles partagées avec le web** : catalogue, calcul des points, niveaux, succès, validation, registre et
configuration Supabase sont importés directement de `../web` (voir `src/shared.ts` et `metro.config.js`).
Modifier une règle dans `web/` la change dans les deux versions.

## Versions épinglées (branche `sdk-58`)

Expo SDK 58, React Native 0.88.1, vision-camera 5.2.4 avec react-native-vision-camera-worklets et
react-native-vision-camera-resizer 5.2.4, react-native-worklets 0.13.0, nitro-modules 0.37.2, nitro-image 0.15.2,
fast-tflite 3.0.1. Ne pas les mettre à jour sans tester sur un vrai téléphone (voir CLAUDE.md).
Autres : supabase-js 2.118.0, async-storage, url-polyfill, expo-image-manipulator, expo-text-extractor 2.0.0,
react-native-webview 14, expo-haptics (versions données par `npx expo install`).

**Détection en direct (vision-camera 5)** : `src/useAircraftDetector.ts`. Le Resizer (GPU) remet l'image à l'endroit
en 320×320 pour le modèle ; s'il n'est pas disponible (Android sans Vulkan), un repli lit les plans YUV en JavaScript.
Le carré de 128 px du moiré est lu à pleine résolution dans les plans YUV. Le diagnostic indique « GPU » ou « CPU ».
`patch-package` reste branché (`postinstall`) pour d'éventuels correctifs dans `patches/` ; celui de vision-camera 4 a été retiré.

## Installation (une seule fois, sur le PC)

Prérequis : Node.js 22.13+ et un compte gratuit sur [expo.dev](https://expo.dev).

```bash
cd native
npm install
npx eas-cli login
npx eas-cli init          # relie le projet à ton compte Expo (ajoute projectId dans app.json)
```

> **Expo Go ne fonctionne pas** : la caméra et l'IA utilisent du code natif. Les compilations se font
> dans le nuage par EAS (pas besoin de Mac).

## Compiler et installer

### Android (pas de compte payant nécessaire)

```bash
npx eas-cli build --profile preview --platform android
```

À la fin (~15 min), EAS donne un lien : les joueurs Android l'ouvrent sur leur téléphone et installent l'APK.

### iPhone (compte Apple Developer requis, 99 $ US/an)

Pour les 5-6 joueurs : **TestFlight**.

```bash
npx eas-cli build --profile production --platform ios
npx eas-cli submit --platform ios --latest
```

Puis dans App Store Connect → TestFlight : ajouter les joueurs (testeurs internes, jusqu'à 100, sans révision
d'Apple s'ils sont ajoutés comme utilisateurs de l'équipe ; sinon testeurs externes avec une courte révision).
Ils installent l'app **TestFlight** sur leur iPhone et acceptent l'invitation.

### Développement (modifier le code sans recompiler)

```bash
npx eas-cli build --profile development --platform android   # ou ios (iPhone enregistré : eas device:create)
npx expo start --dev-client
```

### Mises à jour à distance (expo-updates, sans recompiler)

Les APK `preview` écoutent le canal `preview`. Un changement **de code seulement** (TypeScript, `web/*.js`
partagés, images) s'envoie en 2-3 minutes :

```bash
npx eas-cli update --channel preview --environment preview --message "description du changement"
```

L'app télécharge la mise à jour au lancement et l'applique **au lancement suivant** (la fermer et la rouvrir deux fois).
`runtimeVersion` suit `version` de `app.json` : tout changement **natif** (nouvelle bibliothèque, version d'Expo,
plugin, `app.json`) exige d'augmenter `version` **et** de recompiler, sinon une mise à jour pourrait viser un APK incompatible.

## Tester sur le terrain

Depuis une **zone publique** (stationnement, belvédère) ou une zone où tu as l'autorisation.

1. Ouvre le **Diagnostic** : confiance, taille, netteté, luminosité, zoom et précision GPS en direct.
2. Essaie le **zoom** (boutons ou pincement) sur un avion lointain : la taille doit monter au-dessus de 15 %.
3. Si le cadre vert ne suit pas l'avion, fais une capture d'écran avec le diagnostic ouvert (l'orientation est maintenant gérée par vision-camera).
4. Profil → **Copier les mesures** : envoie le CSV (il contient maintenant la colonne zoom).
