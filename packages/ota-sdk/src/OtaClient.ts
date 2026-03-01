/**
 * OtaClient
 * ─────────
 * Core logic for checking, downloading, and applying OTA updates.
 *
 * Usage:
 *   const client = new OtaClient({ serverUrl, channel, appVersion });
 *   const result = await client.checkForUpdate();
 *   if (result.hasUpdate) await client.downloadAndApply(result.release);
 */

import { Platform } from 'react-native';
import { otaStorage } from './OtaStorage';
import { OtaNativeModule } from './OtaNativeModule';
import type {
  CheckUpdateResponse,
  DownloadProgress,
  OtaConfig,
  OtaRelease,
} from './types';
import { getOtaDirectory, verifyHash, unzipBundle } from './utils/fileUtils';

export class OtaClient {
  private config: Required<OtaConfig>;

  constructor(config: OtaConfig) {
    this.config = {
      strategy: 'BACKGROUND',
      crashThreshold: 3,
      headers: {},
      ...config,
    };
  }

  // ─── Check for Update ────────────────────────────────────────────────────

  async checkForUpdate(): Promise<CheckUpdateResponse> {
    const record = await otaStorage.getRecord();
    const platform = Platform.OS as 'android' | 'ios';
    const currentLabel = record.activeLabel ?? '';

    console.log(`[OTA] Checking for update — channel: ${this.config.channel}, platform: ${platform}, appVersion: ${this.config.appVersion}, currentLabel: "${currentLabel}"`);

    const url = new URL(`${this.config.serverUrl}/v1/check-update`);
    url.searchParams.set('appVersion', this.config.appVersion);
    url.searchParams.set('currentLabel', currentLabel);
    url.searchParams.set('platform', platform);
    url.searchParams.set('channel', this.config.channel);

    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
    });

    if (!resp.ok) {
      throw new Error(
        `[OtaClient] checkForUpdate failed: HTTP ${resp.status}`,
      );
    }

    const data = (await resp.json()) as CheckUpdateResponse;
    otaStorage.setLastChecked(new Date().toISOString());

    if (data.hasUpdate) {
      console.log(`[OTA] Update available — label: ${data.release.label}, size: ${(data.release.size / 1024).toFixed(1)} KB, mandatory: ${data.release.mandatory}`);
    } else {
      console.log('[OTA] Already up-to-date.');
    }

    return data;
  }

  // ─── Download ─────────────────────────────────────────────────────────────

  /**
   * Downloads the release ZIP to the device filesystem.
   * Calls onProgress with 0-100% during download.
   * Verifies SHA-256 hash after download.
   * Returns the absolute path to the extracted bundle file.
   */
  async downloadRelease(
    release: OtaRelease,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<string> {
    const otaDir = await getOtaDirectory(release.label);
    const zipPath = `${otaDir}/update.zip`;

    console.log(`[OTA] Starting download — label: ${release.label}, url: ${release.downloadUrl}`);

    // ── Stream download ────────────────────────────────────────────────────
    const resp = await fetch(release.downloadUrl, {
      headers: this.config.headers,
    });

    if (!resp.ok) {
      throw new Error(
        `[OtaClient] download failed: HTTP ${resp.status}`,
      );
    }

    // React Native / Hermes does not expose resp.body as a ReadableStream,
    // so we use arrayBuffer() to receive the full payload in one shot.
    if (onProgress) onProgress({ bytesWritten: 0, contentLength: release.size, percent: 0 });

    console.log(`[OTA] Fetching body via arrayBuffer…`);
    const buffer = await resp.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const bytesWritten = uint8.length;
    const contentLength = bytesWritten;

    console.log(`[OTA] Download complete — ${(bytesWritten / 1024).toFixed(1)} KB received`);
    if (onProgress) onProgress({ bytesWritten, contentLength, percent: 100 });

    // Write zip to disk via our native write helper
    const base64 = uint8ArraysToBase64([uint8]);
    await writeBase64ToFile(zipPath, base64);

    // ── Verify hash ────────────────────────────────────────────────────────
    console.log(`[OTA] Verifying SHA-256 hash — expected: ${release.hash}`);
    const valid = await verifyHash(zipPath, release.hash);
    if (!valid) {
      console.error(`[OTA] Hash mismatch for release ${release.label}! File may be corrupted.`);
      throw new Error(
        `[OtaClient] hash mismatch for release ${release.label}. ` +
        `Expected ${release.hash}. File may be corrupted.`,
      );
    }
    console.log(`[OTA] Hash verified OK.`);

    // ── Extract ZIP ────────────────────────────────────────────────────────
    console.log(`[OTA] Extracting ZIP to: ${otaDir}`);
    const bundlePath = await unzipBundle(zipPath, otaDir, Platform.OS as 'android' | 'ios');
    console.log(`[OTA] Bundle extracted — path: ${bundlePath}`);

    return bundlePath;
  }

  // ─── Apply ────────────────────────────────────────────────────────────────

  /**
   * Saves the bundle path as pending.
   * For IMMEDIATE strategy, also restarts the app.
   * For BACKGROUND / ON_RESUME, update activates on next cold start.
   */
  async applyUpdate(release: OtaRelease, bundlePath: string): Promise<void> {
    console.log(`[OTA] Marking bundle as pending — label: ${release.label}, path: ${bundlePath}`);
    await otaStorage.setPending(release.label, bundlePath, release.id);

    if (this.config.strategy === 'IMMEDIATE') {
      console.log('[OTA] Strategy is IMMEDIATE — restarting app now.');
      await this.restart();
    } else {
      console.log(`[OTA] Strategy is ${this.config.strategy} — update will apply on next cold start.`);
    }
  }

  /** Convenience: download + apply in one call */
  async downloadAndApply(
    release: OtaRelease,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void> {
    const bundlePath = await this.downloadRelease(release, onProgress);
    await this.applyUpdate(release, bundlePath);
    // Report after staging — fire-and-forget; errors are caught inside reportInstall
    this.reportInstall(release.id, 'installed').catch(() => {});
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  /**
   * Rolls back to the previous good bundle.
   * Clears both active and pending, then restarts.
   */
  async rollback(): Promise<void> {
    console.log('[OTA] Rolling back to previous bundle.');
    const releaseId = otaStorage.activeReleaseId;
    if (releaseId) {
      await this.reportInstall(releaseId, 'rollback').catch(() => {});
    }
    await otaStorage.rollback();
    await this.restart();
  }

  // ─── Report ───────────────────────────────────────────────────────────────

  /**
   * Reports install status back to the server.
   * status: 'installed' | 'rollback' | 'failed'
   * Fire-and-forget safe — errors are logged but never thrown.
   */
  async reportInstall(
    releaseId: string,
    status: 'installed' | 'rollback' | 'failed',
  ): Promise<void> {
    try {
      const platform = Platform.OS as 'android' | 'ios';
      console.log(`[OTA] Reporting install — releaseId: ${releaseId}, status: ${status}`);
      await fetch(`${this.config.serverUrl}/v1/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body: JSON.stringify({
          releaseId,
          status,
          platform,
          appVersion: this.config.appVersion,
        }),
      });
      console.log(`[OTA] Report sent — ${status}`);
    } catch (err: any) {
      console.warn(`[OTA] Failed to send install report: ${err?.message}`);
    }
  }

  // ─── Restart ──────────────────────────────────────────────────────────────

  async restart(): Promise<void> {
    await OtaNativeModule.restartApp();
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get serverUrl() { return this.config.serverUrl; }
  get channel() { return this.config.channel; }
  get strategy() { return this.config.strategy; }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function uint8ArraysToBase64(chunks: Uint8Array[]): string {
  let binary = '';
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      binary += String.fromCharCode(chunk[i]);
    }
  }
  return btoa(binary);
}

async function writeBase64ToFile(path: string, base64: string): Promise<void> {
  // Delegate to native module to write the file since RN JS has no fs access.
  // OtaUpdateModule.writeBase64File() is implemented on both platforms.
  const mod = (await import('./OtaNativeModule')).OtaNativeModule;
  // @ts-ignore — writeBase64File is an extra native method added in the module
  await mod.writeBase64File?.(path, base64);
}
