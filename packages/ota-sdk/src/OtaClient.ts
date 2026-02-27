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

    // ── Stream download ────────────────────────────────────────────────────
    const resp = await fetch(release.downloadUrl, {
      headers: this.config.headers,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(
        `[OtaClient] download failed: HTTP ${resp.status}`,
      );
    }

    const contentLength = Number(
      resp.headers.get('content-length') ?? release.size,
    );
    let bytesWritten = 0;

    // Collect chunks — RNFS write would be used in full native impl,
    // here we collect then write via the native module helper.
    const chunks: Uint8Array[] = [];
    const reader = resp.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytesWritten += value.length;
      if (onProgress) {
        onProgress({
          bytesWritten,
          contentLength,
          percent: Math.round((bytesWritten / contentLength) * 100),
        });
      }
    }

    // Write zip to disk via our native write helper
    const base64 = uint8ArraysToBase64(chunks);
    await writeBase64ToFile(zipPath, base64);

    // ── Verify hash ────────────────────────────────────────────────────────
    const valid = await verifyHash(zipPath, release.hash);
    if (!valid) {
      throw new Error(
        `[OtaClient] hash mismatch for release ${release.label}. ` +
        `Expected ${release.hash}. File may be corrupted.`,
      );
    }

    // ── Extract ZIP ────────────────────────────────────────────────────────
    const bundlePath = await unzipBundle(zipPath, otaDir, Platform.OS as 'android' | 'ios');

    return bundlePath;
  }

  // ─── Apply ────────────────────────────────────────────────────────────────

  /**
   * Saves the bundle path as pending.
   * For IMMEDIATE strategy, also restarts the app.
   * For BACKGROUND / ON_RESUME, update activates on next cold start.
   */
  async applyUpdate(release: OtaRelease, bundlePath: string): Promise<void> {
    await otaStorage.setPending(release.label, bundlePath);

    if (this.config.strategy === 'IMMEDIATE') {
      await this.restart();
    }
  }

  /** Convenience: download + apply in one call */
  async downloadAndApply(
    release: OtaRelease,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void> {
    const bundlePath = await this.downloadRelease(release, onProgress);
    await this.applyUpdate(release, bundlePath);
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  /**
   * Rolls back to the previous good bundle.
   * Clears both active and pending, then restarts.
   */
  async rollback(): Promise<void> {
    await otaStorage.rollback();
    await this.restart();
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
