/**
 * ota-sdk public API
 * ──────────────────
 */

// Types
export type {
  OtaConfig,
  OtaRelease,
  OtaStatus,
  OtaPlatform,
  OtaChannel,
  UpdateStrategy,
  CheckUpdateResponse,
  DownloadProgress,
  OtaInstallRecord,
} from './types';

// Core client
export { OtaClient } from './OtaClient';

// React layer
export { OtaProvider, useOtaUpdate } from './OtaUpdater';

// Storage (for advanced usage)
export { otaStorage } from './OtaStorage';

// Native module (for advanced usage)
export { OtaNativeModule, isSupported } from './OtaNativeModule';

// Crash guard
export { initCrashGuard, markSuccessfulLaunch } from './crashGuard';
