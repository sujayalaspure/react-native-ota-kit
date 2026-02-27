import Foundation
import CommonCrypto
import React

/**
 * OtaUpdateModule (iOS)
 * ──────────────────────
 * React Native native module exposing OTA operations to the JS layer.
 */
@objc(OtaUpdateModule)
class OtaUpdateModule: NSObject, RCTBridgeModule {

    static func moduleName() -> String! { "OtaUpdateModule" }

    // Run all JS-called methods on a background queue
    static func requiresMainQueueSetup() -> Bool { false }

    private var manager: OtaBundleManager { OtaBundleManager.shared }

    // ─── Bundle path accessors ────────────────────────────────────────────────

    @objc func getPendingBundlePath(_ resolve: RCTPromiseResolveBlock,
                                    rejecter reject: RCTPromiseRejectBlock) {
        resolve(manager.pendingBundlePath)
    }

    @objc func setPendingBundle(_ path: String,
                                resolver resolve: RCTPromiseResolveBlock,
                                rejecter reject: RCTPromiseRejectBlock) {
        manager.setPendingBundlePath(path)
        resolve(nil)
    }

    @objc func clearPendingBundle(_ resolve: RCTPromiseResolveBlock,
                                   rejecter reject: RCTPromiseRejectBlock) {
        manager.clearPendingBundlePath()
        resolve(nil)
    }

    @objc func getActiveBundlePath(_ resolve: RCTPromiseResolveBlock,
                                   rejecter reject: RCTPromiseRejectBlock) {
        resolve(manager.activeBundlePath)
    }

    @objc func setActiveBundlePath(_ path: String,
                                   resolver resolve: RCTPromiseResolveBlock,
                                   rejecter reject: RCTPromiseRejectBlock) {
        manager.setActiveBundlePath(path)
        resolve(nil)
    }

    @objc func clearActiveBundlePath(_ resolve: RCTPromiseResolveBlock,
                                      rejecter reject: RCTPromiseRejectBlock) {
        manager.clearActiveBundlePath()
        resolve(nil)
    }

    @objc func setPreviousBundlePath(_ path: String?,
                                     resolver resolve: RCTPromiseResolveBlock,
                                     rejecter reject: RCTPromiseRejectBlock) {
        manager.setPreviousBundlePath(path)
        resolve(nil)
    }

    @objc func getPreviousBundlePath(_ resolve: RCTPromiseResolveBlock,
                                     rejecter reject: RCTPromiseRejectBlock) {
        resolve(manager.previousBundlePath)
    }

    // ─── Crash counter ────────────────────────────────────────────────────────

    @objc func incrementCrashCount(_ resolve: RCTPromiseResolveBlock,
                                   rejecter reject: RCTPromiseRejectBlock) {
        manager.incrementCrashCount()
        resolve(nil)
    }

    @objc func getCrashCount(_ resolve: RCTPromiseResolveBlock,
                             rejecter reject: RCTPromiseRejectBlock) {
        resolve(manager.crashCount)
    }

    @objc func resetCrashCount(_ resolve: RCTPromiseResolveBlock,
                               rejecter reject: RCTPromiseRejectBlock) {
        manager.resetCrashCount()
        resolve(nil)
    }

    // ─── App restart ──────────────────────────────────────────────────────────

    /**
     * On iOS we can't kill and relaunch ourselves (App Store policy).
     * Instead we reload the React Native bundle in-place, which picks up
     * whatever bundleURL() now returns.
     */
    @objc func restartApp(_ resolve: RCTPromiseResolveBlock,
                          rejecter reject: RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            // RCTTriggerReloadCommandListeners is the approved RN API to
            // trigger a bundle reload without exiting the process.
            RCTTriggerReloadCommandListeners("OTA Update")
            resolve(nil)
        }
    }

    // ─── File utilities ───────────────────────────────────────────────────────

    @objc func getOrCreateOtaDir(_ label: String,
                                  resolver resolve: RCTPromiseResolveBlock,
                                  rejecter reject: RCTPromiseRejectBlock) {
        do {
            let dir = try manager.getOrCreateOtaDir(label: label)
            resolve(dir.path)
        } catch {
            reject("DIR_ERROR", error.localizedDescription, error)
        }
    }

    @objc func writeBase64File(_ path: String,
                               base64Data: String,
                               resolver resolve: RCTPromiseResolveBlock,
                               rejecter reject: RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .utility).async {
            guard let data = Data(base64Encoded: base64Data) else {
                reject("DECODE_ERROR", "Invalid base64 data", nil)
                return
            }
            do {
                let url = URL(fileURLWithPath: path)
                try FileManager.default.createDirectory(
                    at: url.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: url, options: .atomic)
                resolve(nil)
            } catch {
                reject("WRITE_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func sha256File(_ path: String,
                          resolver resolve: RCTPromiseResolveBlock,
                          rejecter reject: RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .utility).async {
            do {
                let data = try Data(contentsOf: URL(fileURLWithPath: path))
                var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
                data.withUnsafeBytes { _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &digest) }
                let hex = digest.map { String(format: "%02x", $0) }.joined()
                resolve(hex)
            } catch {
                reject("HASH_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func unzipFile(_ zipPath: String,
                          destDir: String,
                          resolver resolve: RCTPromiseResolveBlock,
                          rejecter reject: RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .utility).async {
            // Use the system unzip process — no third-party dependency needed
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
            process.arguments = ["-o", zipPath, "-d", destDir]
            do {
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus == 0 {
                    resolve(nil)
                } else {
                    reject("UNZIP_ERROR", "unzip exited with code \(process.terminationStatus)", nil)
                }
            } catch {
                reject("UNZIP_ERROR", error.localizedDescription, error)
            }
        }
    }
}
