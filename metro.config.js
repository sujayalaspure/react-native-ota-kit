const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Watch the ota-sdk package source so changes hot-reload in the app
  watchFolders: [
    path.resolve(__dirname, 'packages/ota-sdk'),
  ],
  resolver: {
    // Ensure Metro resolves workspace packages from the root node_modules
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
