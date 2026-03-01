#!/usr/bin/env node
/**
 * start-ota-server.js
 * Launches the OTA server from the workspace root.
 * Usage: node start-ota-server.js
 */
const path = require('path');
const rootDir   = __dirname;
const serverDir = path.join(rootDir, 'packages', 'ota-server');

// Change working directory so relative requires inside the server resolve correctly
process.chdir(serverDir);

// ts-node is hoisted to the root node_modules by yarn workspaces
require(path.join(rootDir, 'node_modules', 'ts-node')).register({
  project: path.join(serverDir, 'tsconfig.json'),
  transpileOnly: true,
});

require(path.join(serverDir, 'src', 'server'));
