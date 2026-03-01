package com.rnappota.ota

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.File

/**
 * OtaBundleManager
 * ────────────────
 * Singleton that reads / writes OTA bundle paths from SharedPreferences.
 * Called from MainApplication BEFORE the React runtime starts, so it must
 * be pure Kotlin — no RN dependencies.
 *
 * Keys:
 *   ota_active_bundle_path    — absolute path of the currently active OTA bundle (or null)
 *   ota_pending_bundle_path   — absolute path of a downloaded-but-not-yet-active bundle
 *   ota_previous_bundle_path  — absolute path of the bundle before the current one (rollback)
 *   ota_crash_count           — number of consecutive cold-start crashes
 */
object OtaBundleManager {

    private const val TAG = "OTA"
    private const val PREFS_NAME = "ota_prefs"
    private const val KEY_ACTIVE = "ota_active_bundle_path"
    private const val KEY_PENDING = "ota_pending_bundle_path"
    private const val KEY_PREVIOUS = "ota_previous_bundle_path"
    private const val KEY_CRASH_COUNT = "ota_crash_count"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ─── Active bundle ────────────────────────────────────────────────────────

    /**
     * Returns the filesystem path of the active OTA bundle, or null if the
     * app should load the bundled APK asset (default behaviour).
     * Also validates the file exists; clears the path and returns null if not.
     */
    fun getActiveBundlePath(): String? {
        val path = prefs.getString(KEY_ACTIVE, null) ?: run {
            Log.d(TAG, "No active OTA bundle — loading from APK asset.")
            return null
        }
        if (!File(path).exists()) {
            Log.w(TAG, "Active bundle path set but file missing: $path — clearing, falling back to APK asset.")
            clearActiveBundlePath()
            return null
        }
        Log.d(TAG, "Active OTA bundle: $path")
        return path
    }

    fun setActiveBundlePath(path: String) {
        prefs.edit().putString(KEY_ACTIVE, path).apply()
    }

    fun clearActiveBundlePath() {
        prefs.edit().remove(KEY_ACTIVE).apply()
    }

    // ─── Pending bundle ───────────────────────────────────────────────────────

    fun getPendingBundlePath(): String? = prefs.getString(KEY_PENDING, null)

    fun setPendingBundlePath(path: String) {
        prefs.edit().putString(KEY_PENDING, path).apply()
    }

    fun clearPendingBundlePath() {
        prefs.edit().remove(KEY_PENDING).apply()
    }

    // ─── Previous bundle (rollback target) ────────────────────────────────────

    fun getPreviousBundlePath(): String? = prefs.getString(KEY_PREVIOUS, null)

    fun setPreviousBundlePath(path: String?) {
        if (path == null) {
            prefs.edit().remove(KEY_PREVIOUS).apply()
        } else {
            prefs.edit().putString(KEY_PREVIOUS, path).apply()
        }
    }

    // ─── Crash counter ────────────────────────────────────────────────────────

    fun getCrashCount(): Int = prefs.getInt(KEY_CRASH_COUNT, 0)

    fun incrementCrashCount() {
        val count = getCrashCount()
        val next = count + 1
        prefs.edit().putInt(KEY_CRASH_COUNT, next).apply()
        Log.d(TAG, "Crash count incremented: $count → $next")
    }

    fun resetCrashCount() {
        prefs.edit().putInt(KEY_CRASH_COUNT, 0).apply()
    }

    // ─── Rollback ─────────────────────────────────────────────────────────────

    /**
     * Atomically rolls back: sets active to previous, clears pending.
     * Called from the crash guard path when JS keeps crashing.
     */
    fun rollback() {
        val previous = getPreviousBundlePath()
        if (previous != null && File(previous).exists()) {
            Log.d(TAG, "Rollback — restoring previous bundle: $previous")
            setActiveBundlePath(previous)
        } else {
            Log.w(TAG, "Rollback — no valid previous bundle found, falling back to APK asset.")
            clearActiveBundlePath()           // fall back to APK asset
        }
        clearPendingBundlePath()
        prefs.edit().remove(KEY_PREVIOUS).apply()
    }

    // ─── OTA files directory ──────────────────────────────────────────────────

    /**
     * Returns (creating if needed) /data/data/<pkg>/files/ota/<label>/
     */
    fun getOrCreateOtaDir(filesDir: File, label: String): File {
        val dir = File(filesDir, "ota/$label")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }
}
