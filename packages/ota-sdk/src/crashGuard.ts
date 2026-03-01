/**
 * crashGuard.ts
 * ─────────────
 * Automatic crash detection + rollback safety net.
 *
 * How it works:
 *  1. Call `initCrashGuard(threshold)` at the very top of index.js,
 *     BEFORE AppRegistry.registerComponent.
 *  2. On every cold start it increments a native crash counter.
 *  3. If the counter reaches `threshold` (default 3), it:
 *       a. Calls OtaStorage.rollback() to restore the previous bundle
 *       b. Restarts the app so the rollback takes effect
 *  4. If the app renders successfully (JS side is healthy), call
 *     `markSuccessfulLaunch()` to reset the counter to 0.
 *
 * Why native counter?
 *   Because if the bundle crashes JS cannot run at all, so we
 *   need native storage (SharedPreferences / UserDefaults) to
 *   track the count across restarts.
 */

import { OtaNativeModule } from './OtaNativeModule';
import { otaStorage } from './OtaStorage';

let _initialized = false;

/**
 * Call this at the very top of index.js before registerComponent.
 * @param threshold Number of crashes before rollback is triggered (default 3)
 */
export async function initCrashGuard(threshold = 3): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  try {
    await OtaNativeModule.incrementCrashCount();
    const count = await OtaNativeModule.getCrashCount();
    console.log(`[OTA] CrashGuard — cold start #${count} (threshold: ${threshold})`);

    if (count >= threshold) {
      console.warn(
        `[OTA] CrashGuard — crash count ${count} reached threshold ${threshold}. Rolling back and restarting.`,
      );
      await otaStorage.rollback();
      await OtaNativeModule.resetCrashCount();
      await OtaNativeModule.restartApp();
    }
  } catch (err) {
    // If the crash guard itself errors, swallow and continue —
    // better to let the app try to run than block startup.
    console.error('[OTA] CrashGuard init error:', err);
  }
}

/**
 * Call this once the React root has mounted successfully.
 * Resets the crash counter so normal launches don't accumulate.
 */
export async function markSuccessfulLaunch(): Promise<void> {
  try {
    const record = await otaStorage.getRecord();

    // If there's a pending bundle that just became active, persist it
    if (record.pendingBundlePath) {
      console.log(`[OTA] Activating pending bundle: ${record.pendingBundlePath}`);
      await otaStorage.activatePending();
      console.log('[OTA] Pending bundle is now active.');
    } else {
      console.log('[OTA] Successful launch — no pending bundle.');
    }

    await OtaNativeModule.resetCrashCount();
    console.log('[OTA] Crash counter reset.');
  } catch (err) {
    console.error('[OTA] markSuccessfulLaunch error:', err);
  }
}
