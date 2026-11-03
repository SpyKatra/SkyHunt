# SkyHunt

Jeu mobile où l'on photographie de vrais avions pour les collectionner. Les points dépendent de la rareté
de l'appareil et du lieu de la photo, avec des classements mondial et national.

## Contenu du dépôt

| Dossier | Quoi | État |
| --- | --- | --- |
| [`web/`](web) | Prototype web (Safari / Chrome sur téléphone) : caméra, détection d'avion en direct, validation, carnet local | Prêt à tester |
| [`native/`](native) | Prototype natif Expo / React Native (iOS et Android), même logique | Prêt, demande un build EAS |

## Tester la version web sur iPhone

1. Ouvre **https://spykatra.github.io/skyhunt/** dans Safari.
2. Touche **Démarrer la caméra**, puis autorise la caméra et la position.
3. Optionnel : **Partager → Sur l'écran d'accueil** pour l'avoir comme une app.

La page est publiée automatiquement par GitHub Actions à chaque modification de `web/`
(Réglages du dépôt → Pages → Source : **GitHub Actions**).

### Ce que fait le prototype

- Caméra intégrée seulement : impossible d'importer une photo de la galerie.
- Détection d'avion en direct (EfficientDet-Lite0, modèle COCO, ~5 analyses/s, exécuté sur le téléphone).
- Validation : confiance ≥ 50 %, avion ≥ 15 % de l'image, netteté et luminosité suffisantes.
- Conseils en direct : « Trop loin », « Image floue », « Trop sombre ».
- Chaque capture garde la photo, la position GPS, l'heure et les mesures, **sur le téléphone uniquement** (IndexedDB).
- Panneau **Diagnostic** avec les valeurs mesurées et des curseurs pour régler les seuils sur le terrain.
- Bouton **Copier les mesures** (CSV) pour envoyer les résultats du test.

Pas encore inclus : identification du type d'avion, serveur, comptes, classements, recoupement ADS-B.
Chaque capture valide vaut 2 points provisoires.

### Protocole de test terrain (YQB)

Depuis une **zone publique** seulement (stationnement, belvédère), jamais côté piste.

1. Ouvre le **Diagnostic**.
2. Prends ~20 photos : avion proche au sol, au décollage, loin dans le ciel, photo floue, contre-jour.
3. Dans **Collection**, touche **Copier les mesures** et colle le résultat dans la conversation.

Critère pour passer à l'étape suivante : avion détecté sur au moins 85 % des photos où il est clairement
visible, et les « points dans le ciel » bien refusés.

## Tester la version web sur ordinateur

```bash
cd web
python3 -m http.server 8000
# puis ouvrir http://localhost:8000 (la caméra ne marche qu'en https ou sur localhost)
```

## Licences des composants

- Modèle EfficientDet-Lite0 et TFLite Web API (`web/vendor/tflite`) : TensorFlow, licence Apache 2.0.
