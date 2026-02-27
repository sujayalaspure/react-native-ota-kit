// ─── Shared TypeScript types for the OTA SDK ────────────────────────────────

export type OtaPlatform = 'android' | 'ios';

export type OtaChannel = 'production' | 'staging' | string;

export type UpdateStrategy =
  | 'BACKGROUND'   // download silently, apply on next cold start (default)
  | 'IMMEDIATE'    // download then immediately restart the app
  | 'ON_RESUME';   // apply when app comes back to foreground after download

export type OtaStatus =
  | 'IDLE'
  | 'CHECKING'
  | 'UPDATE_AVAILABLE'
  | 'DOWNLOADING'
  | 'READY_TO_INSTALL'
  | 'INSTALLING'
  | 'UP_TO_DATE'
  | 'ERROR'
  | 'ROLLED_BACK';

/** Shape returned by GET /v1/check-update when an update exists */
export interface OtaRelease {
  id: string;
  label: string;
  downloadUrl: string;
  /** SHA-256 hex of the ZIP file */
  hash: string;
  /** Size in bytes */
  size: number;
  mandatory: boolean;
  minAppVersion: string;
  platform: OtaPlatform;
  channel: OtaChannel;
  createdAt: string;
}

/** Response from GET /v1/check-update */
export type CheckUpdateResponse =
  | { hasUpdate: true; release: OtaRelease }
  | { hasUpdate: false };

/** Progress event emitted during download */
export interface DownloadProgress {
  bytesWritten: number;
  contentLength: number;
  /** 0–100 */
  percent: number;
}

/** Config passed to OtaClient / OtaUpdater */
export interface OtaConfig {
  /** Base URL of the OTA server, e.g. https://ota.example.com */
  serverUrl: string;
  /** Deployment channel */
  channel: OtaChannel;
  /** Current app version as semver, e.g. "1.0.0" */
  appVersion: string;
  /** Update strategy — defaults to BACKGROUND */
  strategy?: UpdateStrategy;
  /** Number of JS crashes before automatic rollback (default: 3) */
  crashThreshold?: number;
  /** Extra headers to attach to every server request (e.g. auth) */
  headers?: Record<string, string>;
}

/** Internal state stored in AsyncStorage / SharedPreferences */
export interface OtaInstallRecord {
  /** Currently running bundle label, or null for the APK-bundled JS */
  activeLabel: string | null;
  /** Label that has been downloaded and is pending first boot */
  pendingLabel: string | null;
  /** Absolute filesystem path to the pending bundle file */
  pendingBundlePath: string | null;
  /** Absolute filesystem path to the active bundle file (null = APK asset) */
  activeBundlePath: string | null;
  /** Rollback target — the label before the pending one */
  previousLabel: string | null;
  previousBundlePath: string | null;
  /** ISO timestamp of last successful update check */
  lastChecked: string | null;
}
