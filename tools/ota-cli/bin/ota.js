#!/usr/bin/env node
'use strict';

const path = require('path');

// ts-node is hoisted to the workspace root node_modules by yarn workspaces.
// Walk up from this file to find it.
function findModule(name) {
  const locations = [
    path.join(__dirname, '..', 'node_modules', name),         // local
    path.join(__dirname, '..', '..', '..', 'node_modules', name), // workspace root
  ];
  for (const loc of locations) {
    try { return require(loc); } catch (_) {}
  }
  throw new Error(`Cannot find module '${name}'. Run 'yarn install' from the workspace root.`);
}

if (!process.env.OTA_CLI_COMPILED) {
  findModule('ts-node').register({ transpileOnly: true });
  require('../src/index');
} else {
  require('../dist/index');
}
