module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo ajoute lui-même le plugin de react-native-worklets (frame processors).
    presets: ['babel-preset-expo'],
  };
};
