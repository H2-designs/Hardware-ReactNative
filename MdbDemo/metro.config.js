const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

// react-native-mdb is a local package installed via a file: symlink; Metro on Windows needs to
// be told about it explicitly so the bundler can resolve and watch it.
const mdbLibPath = path.resolve(__dirname, '..', 'react-native-mdb');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [mdbLibPath],
  resolver: {
    extraNodeModules: {
      'react-native-mdb': mdbLibPath,
    },
    // The library sits outside the app root, so modules it imports (react-native, react)
    // must resolve back into the app's own node_modules.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
