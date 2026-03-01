# OTA Update System — Architecture

## Overview

This is a self-hosted, CodePush-free OTA (Over-the-Air) update system for React Native. It allows JS bundle changes to be delivered to devices without going through the app store, as long as the native binary (APK/IPA) remains unchanged.

The system has four main components:

| Component        | Language   | Location                 | Role                                      |
|------------------|------------|--------------------------|-------------------------------------------|
| OTA Server       | TypeScript | `packages/ota-server/`   | Stores and serves update bundles          |
| OTA CLI          | Node.js    | `tools/ota-cli/`         | Bundles JS and publishes to server        |
| OTA SDK (JS)     | TypeScript | `packages/ota-sdk/`      | Client logic — check, download, apply     |
| Native (Android) | Kotlin     | `android/`               | File I/O, bundle path selection, restart  |
| Native (iOS)     | Swift      | `ios/`                   | File I/O, bundle path selection, reload   |

---

## High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                          Developer Machine                         │
│                                                                    │
│   ┌─────────────┐     bundle + publish     ┌────────────────────┐  │
│   │   ota-cli   │ ─────────────────────>   │    OTA Server      │  │
│   │  (Node CLI) │                          │  (Express + SQLite)│  │
│   └─────────────┘                          └────────────────────┘  │
│                                                      │             │
└──────────────────────────────────────────────────────┼─────────────┘
                                                       │ HTTP
                          ┌────────────────────────────┴──────────────────┐
                          │                                               │
           ┌──────────────▼─────────────┐                  ┌──────────────▼─────────────┐
           │        Android Device      │                  │         iOS Device         │
           │                            │                  │                            │
           │  ┌─────────────────────┐   │                  │  ┌─────────────────────┐   │
           │  │   Native Layer      │   │                  │  │   Native Layer      │   │
           │  │  (Kotlin)           │   │                  │  │  (Swift)            │   │
           │  │  OtaBundleManager   │   │                  │  │  OtaBundleManager   │   │
           │  │  OtaUpdateModule    │   │                  │  │  OtaUpdateModule    │   │
           │  │  MainApplication    │   │                  │  │  AppDelegate        │   │
           │  └──────────┬──────────┘   │                  │  └──────────┬──────────┘   │
           │             │              │                  │             │              │
           │  ┌──────────▼──────────┐   │                  │  ┌──────────▼──────────┐   │
           │  │   JS Layer (SDK)    │   │                  │  │   JS Layer (SDK)    │   │
           │  │  OtaClient          │   │                  │  │  OtaClient          │   │
           │  │  OtaUpdater         │   │                  │  │  OtaUpdater         │   │
           │  │  OtaStorage         │   │                  │  │  OtaStorage         │   │
           │  │  crashGuard         │   │                  │  │  crashGuard         │   │
           │  └──────────┬──────────┘   │                  │  └──────────┬──────────┘   │
           │             │              │                  │             │              │
           │  ┌──────────▼──────────┐   │                  │  ┌──────────▼──────────┐   │
           │  │     App UI          │   │                  │  │     App UI          │   │
           │  │   OtaBanner         │   │                  │  │   OtaBanner         │   │
           │  └─────────────────────┘   │                  │  └─────────────────────┘   │
           └────────────────────────────┘                  └────────────────────────────┘
```

---

## Component Breakdown

### 1. OTA CLI (`tools/ota-cli/`)

- **bundle**: Metro bundler → JS bundle + assets → ZIP → SHA-256
- **publish**: `POST /v1/publish` multipart form with ZIP + metadata

### 2. OTA Server (`packages/ota-server/`)

Express.js + SQLite. Behaviour identical for both platforms. Compares `created_at` of `currentLabel` against available releases to determine if a newer one exists.

### 3. OTA SDK — JS Layer (`packages/ota-sdk/src/`)

Shared TypeScript — runs on Hermes on both platforms.

| File              | Role                                                                 |
|-------------------|----------------------------------------------------------------------|
| `OtaClient.ts`    | HTTP: check update, download (`arrayBuffer`), verify hash, extract   |
| `OtaUpdater.tsx`  | React Context + `useOtaUpdate()` hook, AppState foreground listener  |
| `OtaStorage.ts`   | Read/write bundle paths via native bridge; derive labels from paths  |
| `crashGuard.ts`   | Crash counter on every cold start; rollback at threshold             |
| `utils/fileUtils` | Wrappers: `getOtaDirectory`, `verifyHash`, `unzipBundle`             |

### 4. Native Layer — Android vs iOS

| Aspect                  | Android (Kotlin)                                               | iOS (Swift)                                              |
|-------------------------|----------------------------------------------------------------|----------------------------------------------------------|
| Bundle manager          | `OtaBundleManager.kt` — `object` singleton                     | `OtaBundleManager.swift` — `@objc` class singleton       |
| Persistent storage      | `SharedPreferences` (`ota_prefs`)                              | `UserDefaults.standard`                                  |
| Keys                    | `ota_active_bundle_path`, `ota_pending_bundle_path`, `ota_previous_bundle_path`, `ota_crash_count` | Same keys |
| Bundle selection point  | `MainApplication.kt` → `getDefaultReactHost(jsBundleFilePath:)` | `AppDelegate.swift` → `ReactNativeDelegate.bundleURL()`  |
| Debug bundle            | Metro dev server (unchanged)                                   | `RCTBundleURLProvider.sharedSettings().jsBundleURL()`    |
| Release fallback        | `jsBundleFilePath = null` → `assets://index.android.bundle`    | `Bundle.main.url(forResource: "main", withExtension: "jsbundle")` |
| Native module           | `OtaUpdateModule.kt` extends `ReactContextBaseJavaModule`      | `OtaUpdateModule.swift` implements `RCTBridgeModule`     |
| Restart mechanism       | `AlarmManager` relaunch + `Process.killProcess()`              | `RCTTriggerReloadCommandListeners` — in-process JS reload |
| File write              | Base64 decode → `FileOutputStream`                             | Base64 decode → `Data.write(to:)`                        |
| SHA-256                 | `MessageDigest("SHA-256")` — java.security                     | `CC_SHA256` — CommonCrypto                               |
| Unzip                   | `ZipInputStream` — java.util.zip                               | `FileManager` + manual unzip                             |

---

## Data Flow

### A. Publishing an Update

```
Developer changes JS code
        │
        ▼
yarn ota:bundle --label v1.0.9 --platform android|ios
        │
        ▼  Metro bundler
index.android.bundle / main.jsbundle + assets/
        │
        ▼  archived + hashed
ota-output/v1.0.9-android.zip  (SHA-256 computed)
        │
        ▼
yarn ota:publish --label v1.0.9 --platform android|ios
        │
        ▼  POST /v1/publish  (multipart, x-ota-secret)
OTA Server → ZIP saved to disk, metadata into SQLite
        │
        ▼
{ "success": true, "id": "<uuid>" }
```

---

### B. Cold Start — Bundle Selection

#### Android (Kotlin — runs before JS)

```
App process starts
        │
        ▼
MainApplication.onCreate()
  └─► OtaBundleManager.init(context)       ← SharedPreferences
        │
        ▼
MainApplication.reactHost (lazy init)
  └─► OtaBundleManager.getActiveBundlePath()
        │
        ├── path exists? → getDefaultReactHost(jsBundleFilePath = path)
        │                         React Native loads OTA bundle ✅
        │
        └── null/missing → getDefaultReactHost(jsBundleFilePath = null)
                                  React Native loads APK asset ✅
```

#### iOS (Swift — runs before JS)

```
App launches
        │
        ▼
AppDelegate.application(_:didFinishLaunchingWithOptions:)
  └─► RCTReactNativeFactory.startReactNative(...)
        │
        ▼
ReactNativeDelegate.bundleURL()
        │
        ├── DEBUG  → RCTBundleURLProvider → Metro dev server URL
        │
        └── RELEASE
              │
              ▼
        OtaBundleManager.shared.activeBundleURL
              │
              ├── URL on disk? → return otaURL  (.../ota/v1.0.9/main.jsbundle) ✅
              │
              └── nil/missing → Bundle.main.url(forResource: "main", withExtension: "jsbundle") ✅
```

---

### C. Crash Guard — Startup Safety

Same JS logic on both platforms, runs in `index.js` before `AppRegistry.registerComponent`:

```
JS starts
        │
        ▼
initCrashGuard()
        │
        ▼
incrementCrashCount()
  Android → SharedPreferences  |  iOS → UserDefaults
        │
        ▼
count >= threshold (3)?
        │
        ├── YES → rollback() + resetCrashCount() + restartApp()
        │           Android: AlarmManager → Process.killProcess()  (full cold restart)
        │           iOS:     RCTTriggerReloadCommandListeners       (in-process JS reload)
        │
        └── NO  → continue startup
```

On successful render, `markSuccessfulLaunch()` is called from `AppContent`:

```
markSuccessfulLaunch()
        │
        ▼
pendingBundlePath exists?
        │
        ├── YES → activatePending()
        │          setActiveBundlePath(pendingPath)   ← SharedPreferences / UserDefaults
        │          clearPendingBundle()
        │          save old active → previousBundlePath (rollback target)
        │
        └── NO  → skip
        │
        ▼
resetCrashCount()
```

---

### D. Checking and Downloading an Update

Same JS code on both platforms:

```
OtaProvider mounts
        │
        ▼
GET /v1/check-update?appVersion=1.0.0&currentLabel=v1.0.9&platform=android|ios&channel=production
        │
        ▼  SQL: WHERE created_at > (SELECT created_at FROM releases WHERE label = @currentLabel)
        │
        ├── no newer release → { hasUpdate: false } → status = UP_TO_DATE
        │
        └── newer release → { hasUpdate: true, release: { label, downloadUrl, hash, ... } }
                │
                ▼  status = DOWNLOADING
                │
          fetch(downloadUrl) → resp.arrayBuffer()   ← works on Hermes (Android + iOS)
                │
                ▼
          uint8Array → base64
                │
                ▼
          OtaUpdateModule.writeBase64File(zipPath, base64)
            Android: FileOutputStream              iOS: Data.write(to:)
                │
                ▼
          OtaUpdateModule.sha256File(zipPath)
            Android: MessageDigest("SHA-256")      iOS: CC_SHA256 (CommonCrypto)
                │
                ▼
          OtaUpdateModule.unzipFile(zipPath, destDir)
            Android: ZipInputStream                iOS: FileManager + manual unzip
                │
                ▼
          OtaStorage.setPending(label, bundlePath)
            Android: SharedPreferences             iOS: UserDefaults
                │
                ▼
          status = READY_TO_INSTALL (BACKGROUND) / auto-restart (IMMEDIATE)
```

---

### E. Applying the Update

```
BACKGROUND:
  User taps "Restart" banner (or next cold start)
        │
        ▼
  OtaUpdateModule.restartApp()
    Android → AlarmManager relaunch in 300ms → Process.killProcess()
              → MainApplication re-runs → reads new active bundle path
    iOS     → RCTTriggerReloadCommandListeners
              → bundleURL() returns new OTA URL → JS reloads in-process

IMMEDIATE:
  Auto-restart triggered right after download completes
```

---

### F. Rollback Flow

```
Bundle crashes × crashThreshold (default 3)
        │
        ▼
otaStorage.rollback()
  previousBundlePath? → setActiveBundlePath(previousPath)
  none?               → clearActiveBundlePath()  (fall back to shipped asset)
        │
        ▼
resetCrashCount() → restartApp()
  Android: full cold restart via AlarmManager
  iOS:     in-process JS reload via RCTTriggerReloadCommandListeners
```

---

## OTA Status State Machine

```
          ┌──────────┐
          │   IDLE   │
          └────┬─────┘
               │ checkForUpdate()
               ▼
          ┌──────────┐
          │ CHECKING │
          └────┬─────┘
     ┌─────────┴──────────┐
     │ no update          │ update found
     ▼                    ▼
┌───────────┐    ┌──────────────────┐
│ UP_TO_DATE│    │ UPDATE_AVAILABLE │ (auto-download for BACKGROUND/IMMEDIATE)
└───────────┘    └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────┐
                 │ DOWNLOADING  │  progress 0→100%
                 └──────┬───────┘
              ┌─────────┴─────────┐
              │ success           │ error
              ▼                   ▼
     ┌─────────────────┐    ┌───────────┐
     │ READY_TO_INSTALL│    │   ERROR   │ (auto-hides 5s)
     └────────┬────────┘    └───────────┘
              │ applyNow() / restart
              ▼
       ┌────────────┐
       │ INSTALLING │
       └─────┬──────┘
             │ crash × threshold
             ▼
       ┌─────────────┐
       │ ROLLED_BACK │ (auto-hides 5s)
       └─────────────┘
```

---

## Storage Layers

| What                  | Android                           | iOS                              | Access layer                              |
|-----------------------|-----------------------------------|----------------------------------|-------------------------------------------|
| Active bundle path    | SharedPreferences                 | UserDefaults                     | `OtaBundleManager` (native) + bridge      |
| Pending bundle path   | SharedPreferences                 | UserDefaults                     | Same                                      |
| Previous bundle path  | SharedPreferences                 | UserDefaults                     | Same (rollback target)                    |
| Crash count           | SharedPreferences                 | UserDefaults                     | Same                                      |
| Release metadata      | SQLite `ota.db` (server)          | SQLite `ota.db` (server)         | OTA Server only                           |
| Bundle ZIPs (server)  | `packages/ota-server/data/`       | Same                             | Server disk                               |
| Bundle ZIPs (device)  | `/data/user/0/<pkg>/files/ota/<label>/` | `<Documents>/ota/<label>/` | OtaUpdateModule native bridge             |
| In-session label      | JS memory                         | JS memory                        | Derived from path in `OtaStorage.load()`  |

---

## Key Design Decisions

### Why SharedPreferences (Android) / UserDefaults (iOS)?
The native entry point must know which bundle to load **before JS executes**. These are the only storage APIs readable before the JS engine starts.

### Why `arrayBuffer()` instead of streaming?
Hermes does not implement `ReadableStream` / `getReader()` on `Response.body`. `response.arrayBuffer()` is fully supported on both Android and iOS Hermes.

### Why derive labels from paths?
Labels are not stored natively — only file paths are. The JS layer derives the label from the directory name in the path (`.../ota/<label>/main.jsbundle`), keeping the native layer minimal and schema-free.

### Why `created_at` comparison instead of `label !=`?
Label strings are not reliably sortable (e.g. "v1.0.10" < "v1.0.9" lexicographically). `created_at` timestamp comparison ensures a device always receives only releases published **after** its current one.

### Why AlarmManager on Android but `RCTTriggerReloadCommandListeners` on iOS?
Android requires a full process kill + relaunch so `MainApplication` re-runs and re-selects `jsBundleFilePath`. `AlarmManager` schedules a relaunch 300ms after `Process.killProcess()`.

iOS App Store guidelines prohibit `exit(0)`. Instead, `RCTTriggerReloadCommandListeners` triggers an in-process JS bundle reload — `bundleURL()` is called again, returning the new OTA URL. No process kill required.

### Why is the JS SDK shared across platforms?
`OtaClient`, `OtaStorage`, `OtaUpdater`, and `crashGuard` are pure TypeScript with zero platform-specific code. All platform differences (file write, hash, unzip, restart, storage) are abstracted behind `OtaUpdateModule`, which exposes identical method names and Promise-based signatures on both Kotlin and Swift.