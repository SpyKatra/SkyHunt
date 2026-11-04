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

## Versions figées

Expo SDK 56, React Native 0.85.3, vision-camera 4.7.3, worklets-core 1.6.3, resize-plugin 3.2.0,
fast-tflite 3.0.1, nitro-modules 0.37.1 : **ne pas les mettre à jour** (voir CLAUDE.md).
Ajouts 0.5 (versions compatibles SDK 56, installées avec `npx expo install`) : supabase-js 2.118.0,
async-storage, url-polyfill, expo-image-manipulator, expo-text-extractor 2.0.0, react-native-webview, expo-haptics.

À savoir : `expo-doctor` signale une fuite de mémoire connue de Hermes dans RN 0.85, corrigée dans
Expo SDK 57. À surveiller pendant les tests (l'app qui ralentit ou se ferme après un long moment de chasse).

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

## Tester sur le terrain

Depuis une **zone publique** (stationnement, belvédère) ou une zone où tu as l'autorisation.

1. Ouvre le **Diagnostic** : confiance, taille, netteté, luminosité, zoom et précision GPS en direct.
2. Essaie le **zoom** (boutons ou pincement) sur un avion lointain : la taille doit monter au-dessus de 15 %.
3. Si le cadre vert ne suit pas l'avion, touche **↻ Orientation** jusqu'à ce qu'il tombe juste et note l'angle.
4. Profil → **Copier les mesures** : envoie le CSV (il contient maintenant la colonne zoom).
