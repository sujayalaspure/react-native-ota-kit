/**
 * fileUtils.ts
 * ─────────────
 * Filesystem helpers for OTA bundle management.
 * All operations are delegated to the native OtaUpdateModule
 * since React Native JS has no direct filesystem access.
 */

import { Platform } from 'react-native';
import { OtaNativeModule } from '../OtaNativeModule';

/** Returns/creates the OTA directory for a given label */
export async function getOtaDirectory(label: string): Promise<string> {
  // @ts-ignore
  const dir: string = await OtaNativeModule.getOrCreateOtaDir?.(label);
  return dir;
}

/**
 * Verifies the SHA-256 hash of a file on disk.
 * Returns true if the file matches the expected hex hash.
 */
export async function verifyHash(
  filePath: string,
  expectedHex: string,
): Promise<boolean> {
  // @ts-ignore
  const actual: string = await OtaNativeModule.sha256File?.(filePath);
  return actual?.toLowerCase() === expectedHex.toLowerCase();
}

/**
 * Unzips an update ZIP and returns the absolute path to the JS bundle file.
 * ZIP is expected to contain:
 *   metadata.json
 *   index.android.bundle  (android) OR main.jsbundle (ios)
 *   assets/...
 */
export async function unzipBundle(
  zipPath: string,
  destDir: string,
  platform: 'android' | 'ios',
): Promise<string> {
  // @ts-ignore
  await OtaNativeModule.unzipFile?.(zipPath, destDir);

  const bundleFileName =
    platform === 'android' ? 'index.android.bundle' : 'main.jsbundle';

  return `${destDir}/${bundleFileName}`;
}

/** Returns the assets directory for an OTA label */
export function getOtaAssetsDir(otaDir: string): string {
  return `${otaDir}/assets`;
}

/** Bundle file name per platform */
export function getBundleFileName(platform: 'android' | 'ios'): string {
  return platform === 'android' ? 'index.android.bundle' : 'main.jsbundle';
}
