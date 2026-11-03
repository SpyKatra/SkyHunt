const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Permet d'importer le modèle de détection avec require('...tflite')
config.resolver.assetExts.push('tflite');

module.exports = config;
