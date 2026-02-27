#!/usr/bin/env node
'use strict';

// Bootstrap — ts-node in dev, compiled JS in prod
if (!process.env.OTA_CLI_COMPILED) {
  require('ts-node').register({ transpileOnly: true });
  require('../src/index');
} else {
  require('../dist/index');
}
