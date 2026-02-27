import Foundation

/**
 * OtaBundleManager (iOS)
 * ──────────────────────
 * Singleton that reads / writes OTA bundle paths from UserDefaults.
 * Called from AppDelegate.bundleURL() BEFORE any JS executes.
 */
@objc public class OtaBundleManager: NSObject {

    @objc public static let shared = OtaBundleManager()

    private let defaults = UserDefaults.standard

    private enum Key {
        static let active   = "ota_active_bundle_path"
        static let pending  = "ota_pending_bundle_path"
        static let previous = "ota_previous_bundle_path"
        static let crashCount = "ota_crash_count"
    }

    // ─── Active bundle ────────────────────────────────────────────────────────

    /// The URL of the active OTA bundle, or nil to use the shipped main.jsbundle.
    @objc public var activeBundleURL: URL? {
        guard let path = defaults.string(forKey: Key.active) else { return nil }
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else {
            clearActiveBundlePath()
            return nil
        }
        return url
    }

    @objc public var activeBundlePath: String? {
        return defaults.string(forKey: Key.active)
    }

    @objc public func setActiveBundlePath(_ path: String) {
        defaults.set(path, forKey: Key.active)
    }

    @objc public func clearActiveBundlePath() {
        defaults.removeObject(forKey: Key.active)
    }

    // ─── Pending bundle ───────────────────────────────────────────────────────

    @objc public var pendingBundlePath: String? {
        return defaults.string(forKey: Key.pending)
    }

    @objc public func setPendingBundlePath(_ path: String) {
        defaults.set(path, forKey: Key.pending)
    }

    @objc public func clearPendingBundlePath() {
        defaults.removeObject(forKey: Key.pending)
    }

    // ─── Previous bundle (rollback) ───────────────────────────────────────────

    @objc public var previousBundlePath: String? {
        return defaults.string(forKey: Key.previous)
    }

    @objc public func setPreviousBundlePath(_ path: String?) {
        if let p = path {
            defaults.set(p, forKey: Key.previous)
        } else {
            defaults.removeObject(forKey: Key.previous)
        }
    }

    // ─── Crash counter ────────────────────────────────────────────────────────

    @objc public var crashCount: Int {
        return defaults.integer(forKey: Key.crashCount)
    }

    @objc public func incrementCrashCount() {
        defaults.set(crashCount + 1, forKey: Key.crashCount)
    }

    @objc public func resetCrashCount() {
        defaults.set(0, forKey: Key.crashCount)
    }

    // ─── Rollback ─────────────────────────────────────────────────────────────

    @objc public func rollback() {
        if let prev = previousBundlePath,
           FileManager.default.fileExists(atPath: prev) {
            setActiveBundlePath(prev)
        } else {
            clearActiveBundlePath()
        }
        clearPendingBundlePath()
        defaults.removeObject(forKey: Key.previous)
    }

    // ─── OTA files directory ──────────────────────────────────────────────────

    /// Returns (creating if needed) <Documents>/ota/<label>/
    @objc public func getOrCreateOtaDir(label: String) throws -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("ota/\(label)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
