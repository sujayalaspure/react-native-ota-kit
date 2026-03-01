package com.rnappota.ota

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import java.io.*
import java.security.MessageDigest
import java.util.zip.ZipInputStream

/**
 * OtaUpdateModule
 * ───────────────
 * React Native native module exposing OTA operations to the JS layer.
 *
 * All heavy blocking I/O (hash, unzip, file write) runs on a background
 * thread via `AsyncTask`-style `ReactAsyncTask` pattern using Kotlin coroutines
 * wrapped in RN's `UiThreadUtil` / `runOnExecutorThread`.
 */
class OtaUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val TAG = "OTA"

    override fun getName() = "OtaUpdateModule"

    // ─── Bundle path accessors ────────────────────────────────────────────────

    @ReactMethod
    fun getPendingBundlePath(promise: Promise) {
        promise.resolve(OtaBundleManager.getPendingBundlePath())
    }

    @ReactMethod
    fun setPendingBundle(path: String, promise: Promise) {
        OtaBundleManager.setPendingBundlePath(path)
        promise.resolve(null)
    }

    @ReactMethod
    fun clearPendingBundle(promise: Promise) {
        OtaBundleManager.clearPendingBundlePath()
        promise.resolve(null)
    }

    @ReactMethod
    fun getActiveBundlePath(promise: Promise) {
        promise.resolve(OtaBundleManager.getActiveBundlePath())
    }

    @ReactMethod
    fun setActiveBundlePath(path: String, promise: Promise) {
        OtaBundleManager.setActiveBundlePath(path)
        promise.resolve(null)
    }

    @ReactMethod
    fun clearActiveBundlePath(promise: Promise) {
        OtaBundleManager.clearActiveBundlePath()
        promise.resolve(null)
    }

    @ReactMethod
    fun setPreviousBundlePath(path: String?, promise: Promise) {
        OtaBundleManager.setPreviousBundlePath(path)
        promise.resolve(null)
    }

    @ReactMethod
    fun getPreviousBundlePath(promise: Promise) {
        promise.resolve(OtaBundleManager.getPreviousBundlePath())
    }

    // ─── Crash counter ────────────────────────────────────────────────────────

    @ReactMethod
    fun incrementCrashCount(promise: Promise) {
        OtaBundleManager.incrementCrashCount()
        promise.resolve(null)
    }

    @ReactMethod
    fun getCrashCount(promise: Promise) {
        promise.resolve(OtaBundleManager.getCrashCount())
    }

    @ReactMethod
    fun resetCrashCount(promise: Promise) {
        OtaBundleManager.resetCrashCount()
        promise.resolve(null)
    }

    // ─── App restart ──────────────────────────────────────────────────────────

    /**
     * Schedules a 300ms-delayed re-launch of the app via AlarmManager,
     * then kills the current process. This forces a cold start so the
     * new bundle path is picked up by MainApplication.
     */
    @ReactMethod
    fun restartApp(promise: Promise) {
        try {
            Log.d(TAG, "Restarting app to load new bundle.")
            val ctx = reactContext.applicationContext
            val packageManager = ctx.packageManager
            val intent = packageManager.getLaunchIntentForPackage(ctx.packageName)!!.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            }
            val pendingIntent = PendingIntent.getActivity(
                ctx,
                0,
                intent,
                PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE,
            )
            val alarmManager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarmManager.set(
                AlarmManager.RTC,
                System.currentTimeMillis() + 300,
                pendingIntent,
            )
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("RESTART_ERROR", e.message, e)
        } finally {
            android.os.Process.killProcess(android.os.Process.myPid())
        }
    }

    // ─── File utilities ───────────────────────────────────────────────────────

    /** Returns/creates the OTA directory for the given label */
    @ReactMethod
    fun getOrCreateOtaDir(label: String, promise: Promise) {
        try {
            val dir = OtaBundleManager.getOrCreateOtaDir(reactContext.filesDir, label)
            promise.resolve(dir.absolutePath)
        } catch (e: Exception) {
            promise.reject("DIR_ERROR", e.message, e)
        }
    }

    /** Writes a Base64-encoded string to a file on disk */
    @ReactMethod
    fun writeBase64File(path: String, base64Data: String, promise: Promise) {
        Thread {
            try {
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                val file = File(path)
                file.parentFile?.mkdirs()
                FileOutputStream(file).use { it.write(bytes) }
                Log.d(TAG, "writeBase64File — wrote ${bytes.size} bytes to $path")
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "writeBase64File error: ${e.message}")
                promise.reject("WRITE_ERROR", e.message, e)
            }
        }.start()
    }

    /** Returns the SHA-256 hex digest of a file at the given path */
    @ReactMethod
    fun sha256File(path: String, promise: Promise) {
        Thread {
            try {
                Log.d(TAG, "sha256File — hashing: $path")
                val digest = MessageDigest.getInstance("SHA-256")
                FileInputStream(path).use { fis ->
                    val buffer = ByteArray(8192)
                    var bytes = fis.read(buffer)
                    while (bytes != -1) {
                        digest.update(buffer, 0, bytes)
                        bytes = fis.read(buffer)
                    }
                }
                val hex = digest.digest().joinToString("") { "%02x".format(it) }
                Log.d(TAG, "sha256File — result: $hex")
                promise.resolve(hex)
            } catch (e: Exception) {
                Log.e(TAG, "sha256File error: ${e.message}")
                promise.reject("HASH_ERROR", e.message, e)
            }
        }.start()
    }

    /**
     * Extracts a ZIP file at [zipPath] into [destDir].
     * Handles path traversal attacks by validating each entry's canonical path.
     */
    @ReactMethod
    fun unzipFile(zipPath: String, destDir: String, promise: Promise) {
        Thread {
            try {
                Log.d(TAG, "unzipFile — extracting $zipPath → $destDir")
                val dest = File(destDir)
                dest.mkdirs()
                val destCanonical = dest.canonicalPath
                var count = 0

                ZipInputStream(FileInputStream(zipPath)).use { zis ->
                    var entry = zis.nextEntry
                    while (entry != null) {
                        val outFile = File(dest, entry.name)
                        // Security: prevent zip-slip
                        if (!outFile.canonicalPath.startsWith(destCanonical + File.separator)) {
                            throw SecurityException("Zip slip detected: ${entry.name}")
                        }
                        if (entry.isDirectory) {
                            outFile.mkdirs()
                        } else {
                            outFile.parentFile?.mkdirs()
                            FileOutputStream(outFile).use { out ->
                                val buffer = ByteArray(8192)
                                var len = zis.read(buffer)
                                while (len != -1) {
                                    out.write(buffer, 0, len)
                                    len = zis.read(buffer)
                                }
                            }
                            count++
                        }
                        zis.closeEntry()
                        entry = zis.nextEntry
                    }
                }
                Log.d(TAG, "unzipFile — extracted $count files to $destDir")
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "unzipFile error: ${e.message}")
                promise.reject("UNZIP_ERROR", e.message, e)
            }
        }.start()
    }
}
