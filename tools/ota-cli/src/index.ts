#!/usr/bin/env node

import { Command } from 'commander';
import { bundleCommand } from './commands/bundle';
import { publishCommand } from './commands/publish';

const program = new Command();

program
  .name('ota')
  .version('1.0.0')
  .description('OTA Update CLI — bundle and publish React Native updates')
  .addCommand(bundleCommand)
  .addCommand(publishCommand);

program.parse(process.argv);
