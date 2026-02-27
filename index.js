/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { initCrashGuard } from './packages/ota-sdk/src';

// ⚠️  Must run BEFORE registerComponent so a crash-looping bundle
//     can be detected and rolled back before any JS executes.
initCrashGuard(3 /* rollback after 3 consecutive crashes */);

AppRegistry.registerComponent(appName, () => App);
