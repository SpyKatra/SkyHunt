const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Permet d'importer le modèle de détection avec require('...tflite')
config.resolver.assetExts.push('tflite');

// Règles du jeu partagées avec la version web (catalogue, points, registre, validation) :
// une seule source de vérité dans ../web, importée via src/shared.ts.
config.watchFolders = [path.resolve(__dirname, '../web')];

module.exports = config;
