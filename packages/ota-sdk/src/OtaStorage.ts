/**
 * OtaStorage
 * ──────────
 * Manages persistent OTA state. There are two storage layers:
 *
 * 1. **Native storage** (SharedPreferences / UserDefaults) — for bundle paths
 *    that must survive a cold start and be readable BEFORE JS executes.
 *    Delegated to OtaNativeModule.
 *
 * 2. **In-memory cache** — so we don't call into native on every access.
 *    Populated lazily on first read() call.
 */

import { OtaNativeModule } from './OtaNativeModule';
import type { OtaInstallRecord } from './types';

const DEFAULT_RECORD: OtaInstallRecord = {
  activeLabel: null,
  pendingLabel: null,
  pendingBundlePath: null,
  activeBundlePath: null,
  previousLabel: null,
  previousBundlePath: null,
  lastChecked: null,
};

class OtaStorage {
  private cache: OtaInstallRecord | null = null;
  // In-memory only — survives within a session, used for rollback reporting
  private _pendingReleaseId: string | null = null;
  private _activeReleaseId: string | null = null;

  /** Load current state from native storage (called once per session) */
  async load(): Promise<OtaInstallRecord> {
    if (this.cache) return this.cache;

    const [active, pending, previous] = await Promise.all([
      OtaNativeModule.getActiveBundlePath(),
      OtaNativeModule.getPendingBundlePath(),
      OtaNativeModule.getPreviousBundlePath(),
    ]);

    // Labels are not stored natively — derive them from the path.
    // Path structure: .../ota/<label>/index.android.bundle
    // so the parent directory name is the label.
    const labelFromPath = (path: string | null): string | null => {
      if (!path) return null;
      const parts = path.replace(/\\/g, '/').split('/');
      // bundle file is the last segment; label dir is second-to-last
      return parts.length >= 2 ? parts[parts.length - 2] : null;
    };

    this.cache = {
      ...DEFAULT_RECORD,
      activeBundlePath: active,
      activeLabel: labelFromPath(active),
      pendingBundlePath: pending,
      pendingLabel: labelFromPath(pending),
      previousBundlePath: previous,
      previousLabel: labelFromPath(previous),
      lastChecked: null,
    };

    return this.cache;
  }

  /** Get a snapshot of the current record (may trigger load) */
  async getRecord(): Promise<OtaInstallRecord> {
    return this.load();
  }

  /** Mark a bundle as pending (downloaded, awaiting restart) */
  async setPending(label: string, bundlePath: string, releaseId?: string): Promise<void> {
    await OtaNativeModule.setPendingBundle(bundlePath);
    const rec = await this.load();
    rec.pendingLabel = label;
    rec.pendingBundlePath = bundlePath;
    if (releaseId) this._pendingReleaseId = releaseId;
  }

  /** Promote the pending bundle to active (called after first successful boot) */
  async activatePending(): Promise<void> {
    const rec = await this.load();
    if (!rec.pendingBundlePath) return;

    // Save current active as previous (for rollback)
    const prevPath = rec.activeBundlePath;
    await OtaNativeModule.setPreviousBundlePath(prevPath);
    await OtaNativeModule.setActiveBundlePath(rec.pendingBundlePath);
    await OtaNativeModule.clearPendingBundle();

    rec.previousBundlePath = prevPath;
    rec.previousLabel = rec.activeLabel;
    rec.activeBundlePath = rec.pendingBundlePath;
    rec.activeLabel = rec.pendingLabel;
    rec.pendingBundlePath = null;
    rec.pendingLabel = null;

    // Promote releaseId
    this._activeReleaseId = this._pendingReleaseId;
    this._pendingReleaseId = null;
  }

  /** Rollback to previous bundle */
  async rollback(): Promise<void> {
    const rec = await this.load();
    const prevPath = rec.previousBundlePath;

    if (prevPath) {
      await OtaNativeModule.setActiveBundlePath(prevPath);
    } else {
      // No previous — revert to APK-bundled JS
      await OtaNativeModule.clearActiveBundlePath();
    }

    await OtaNativeModule.clearPendingBundle();

    rec.activeLabel = rec.previousLabel;
    rec.activeBundlePath = prevPath;
    rec.previousLabel = null;
    rec.previousBundlePath = null;
    rec.pendingLabel = null;
    rec.pendingBundlePath = null;
  }

  /** Full reset — go back to APK-bundled JS */
  async reset(): Promise<void> {
    await Promise.all([
      OtaNativeModule.clearActiveBundlePath(),
      OtaNativeModule.clearPendingBundle(),
    ]);
    this.cache = { ...DEFAULT_RECORD };
  }

  get activeReleaseId(): string | null { return this._activeReleaseId; }
  get pendingReleaseId(): string | null { return this._pendingReleaseId; }

  setLastChecked(iso: string): void {
    if (this.cache) this.cache.lastChecked = iso;
  }

  /** Invalidate the in-memory cache (e.g. after restart) */
  invalidate(): void {
    this.cache = null;
  }
}

export const otaStorage = new OtaStorage();
