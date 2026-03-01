# OTA Update System — Architecture

## Overview

This is a self-hosted, CodePush-free OTA (Over-the-Air) update system for React Native. It allows JS bundle changes to be delivered to devices without going through the app store, as long as the native binary (APK/IPA) remains unchanged.

The system has four main components:

| Component       | Language      | Location                        | Role                                     |
|-----------------|---------------|---------------------------------|------------------------------------------|
| OTA Server      | TypeScript    | `packages/ota-server/`          | Stores and serves update bundles         |
| OTA CLI         | Node.js       | `tools/ota-cli/`                | Bundles JS and publishes to server       |
| OTA SDK (JS)    | TypeScript    | `packages/ota-sdk/`             | Client logic — check, download, apply    |
| Native Layer    | Kotlin/Swift  | `android/` / `ios/`             | File I/O, bundle path selection, restart |

---

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Developer Machine                          │
│                                                                     │
│   ┌─────────────┐     bundle + publish     ┌────────────────────┐  │
│   │   ota-cli   │ ─────────────────────>   │    OTA Server      │  │
│   │  (Node CLI) │                          │  (Express + SQLite)│  │
│   └─────────────┘                          └────────────────────┘  │
│                                                      │              │
└──────────────────────────────────────────────────────┼─────────────┘
                                                       │ HTTP (LAN / Internet)
                                         ┌─────────────▼──────────────┐
                                         │        Android Device       │
                                         │                             │
                                         │  ┌─────────────────────┐   │
                                         │  │   Native Layer      │   │
                                         │  │  (Kotlin)           │   │
                                         │  │  OtaBundleManager   │   │
                                         │  │  OtaUpdateModule    │   │
                                         │  └──────────┬──────────┘   │
                                         │             │               │
                                         │  ┌──────────▼──────────┐   │
                                         │  │   JS Layer (SDK)    │   │
                                         │  │  OtaClient          │   │
                                         │  │  OtaUpdater         │   │
                                         │  │  OtaStorage         │   │
                                         │  │  crashGuard         │   │
                                         │  └──────────┬──────────┘   │
                                         │             │               │
                                         │  ┌──────────▼──────────┐   │
                                         │  │     App UI          │   │
                                         │  │   OtaBanner         │   │
                                         │  │   useOtaUpdate()    │   │
                                         │  └─────────────────────┘   │
                                         └─────────────────────────────┘
```

---

## Component Breakdown

### 1. OTA CLI (`tools/ota-cli/`)

Runs on the developer machine. Two main commands:

- **bundle**: Runs Metro bundler to produce a JS bundle + assets → zips them → computes SHA-256
- **publish**: Uploads the ZIP to the OTA server via multipart form POST

```
ota-cli bundle  → [Metro] → index.android.bundle + assets → zip → SHA-256
ota-cli publish → POST /v1/publish (ZIP + metadata + secret)
```

---

### 2. OTA Server (`packages/ota-server/`)

Express.js REST API backed by SQLite (better-sqlite3).

**Responsibilities:**
- Accept and store uploaded bundles
- Compare `currentLabel` vs latest release to determine if update is available
- Serve ZIP files for download
- Record install/rollback reports from devices

**Storage:**
- ZIPs stored on disk (`packages/ota-server/data/bundles/`)
- Metadata in SQLite (`packages/ota-server/data/ota.db`)

---

### 3. OTA SDK — JS Layer (`packages/ota-sdk/src/`)

Pure TypeScript, runs inside the React Native JS engine (Hermes).

| File              | Role                                                                 |
|-------------------|----------------------------------------------------------------------|
| `OtaClient.ts`    | HTTP: check for update, download ZIP (arrayBuffer), verify hash, extract |
| `OtaUpdater.tsx`  | React Context + `useOtaUpdate()` hook, AppState listener            |
| `OtaStorage.ts`   | Read/write bundle paths via native module, derive labels from paths  |
| `crashGuard.ts`   | Increment crash counter on start, rollback if threshold reached      |
| `utils/fileUtils` | Helpers: getOtaDirectory, verifyHash, unzipBundle (via native)       |

---

### 4. Native Layer — Android (`android/app/.../ota/`)

| File                  | Role                                                                          |
|-----------------------|-------------------------------------------------------------------------------|
| `OtaBundleManager.kt` | Singleton. Reads/writes bundle paths in SharedPreferences. Called before JS.  |
| `OtaUpdateModule.kt`  | React Native native module. Exposes file ops (write, sha256, unzip, restart) to JS. |
| `MainApplication.kt`  | On cold start: reads active bundle path → passes to `getDefaultReactHost()`   |

---

## Data Flow

### A. Publishing an Update

```
Developer changes JS code
        │
        ▼
yarn ota:bundle --label v1.0.8 --platform android
        │
        ▼  (Metro bundler)
index.android.bundle + assets
        │
        ▼  (archived + hashed)
ota-output/v1.0.8-android.zip  (SHA-256 computed)
        │
        ▼
yarn ota:publish --label v1.0.8 --platform android
        │
        ▼  POST /v1/publish  (multipart, x-ota-secret)
OTA Server
        │
        ▼
ZIP saved to disk
Metadata inserted into SQLite releases table
        │
        ▼
{ "success": true, "id": "<uuid>" }
```

---

### B. Cold Start — Bundle Selection

This happens in Kotlin, before JS runs:

```
App process starts
        │
        ▼
MainApplication.onCreate()
        │
        ▼
OtaBundleManager.init(context)       ← reads SharedPreferences
        │
        ▼
OtaBundleManager.getActiveBundlePath()
        │
        ├── path exists on disk? ──YES──► jsBundleFilePath = "/data/.../ota/v1.0.8/index.android.bundle"
        │                                          │
        │                                          ▼
        │                                  React Native loads OTA bundle
        │
        └── null / file missing? ──────► jsBundleFilePath = null
                                                   │
                                                   ▼
                                          React Native loads APK asset
                                          (assets://index.android.bundle)
```

---

### C. Crash Guard — Startup Safety

Runs at the very top of `index.js`, before `AppRegistry.registerComponent`:

```
JS starts executing
        │
        ▼
initCrashGuard()
        │
        ▼
OtaUpdateModule.incrementCrashCount()   ← native SharedPreferences
        │
        ▼
getCrashCount() >= threshold (3)?
        │
        ├── YES ──► otaStorage.rollback()           ← restore previous bundle path
        │           OtaUpdateModule.resetCrashCount()
        │           OtaUpdateModule.restartApp()     ← AlarmManager restart
        │
        └── NO  ──► continue app startup
```

If the app renders successfully, `markSuccessfulLaunch()` is called from `AppContent`:

```
markSuccessfulLaunch()
        │
        ▼
pendingBundlePath exists?
        │
        ├── YES ──► otaStorage.activatePending()
        │            ├── setActiveBundlePath(pendingPath)    ← native
        │            ├── clearPendingBundle()                ← native
        │            └── save old active as previousBundlePath (for rollback)
        │
        └── NO  ──► skip
        │
        ▼
resetCrashCount()
```

---

### D. Checking and Downloading an Update

Triggered automatically on app mount by `OtaProvider` (and on app foreground via AppState):

```
OtaProvider mounts
        │
        ▼
checkForUpdate()
        │
        ▼  GET /v1/check-update?appVersion=1.0.0&currentLabel=v1.0.7&platform=android&channel=production
OTA Server
        │
        ▼  SQL: SELECT * FROM releases WHERE created_at > (SELECT created_at FROM releases WHERE label = 'v1.0.7')
        │
        ├── No newer release ──► { hasUpdate: false }  ──► status = UP_TO_DATE
        │
        └── Newer release ──────► { hasUpdate: true, release: { label, downloadUrl, hash, ... } }
                │
                ▼  status = UPDATE_AVAILABLE
                │
          strategy = BACKGROUND or IMMEDIATE?
                │
                ▼  status = DOWNLOADING
                │
          fetch(downloadUrl)  [arrayBuffer — Hermes compatible]
                │
                ▼
          Write base64 ZIP to disk via OtaUpdateModule.writeBase64File()
                │
                ▼
          Verify SHA-256 via OtaUpdateModule.sha256File()
                │
                ▼
          Unzip via OtaUpdateModule.unzipFile()
                │
                ▼
          OtaStorage.setPending(label, bundlePath)  ──► OtaUpdateModule.setPendingBundle(path)
                │
                ▼  status = READY_TO_INSTALL (BACKGROUND)
                   or restart immediately (IMMEDIATE)
```

---

### E. Applying the Update

```
BACKGROUND strategy:
        User sees "Restart to apply" banner
                │
                ▼ (user taps Restart, or next cold start)
        App restarts  [AlarmManager schedules restart]

IMMEDIATE strategy:
        Auto-restart triggered immediately after download
```

On next cold start, `MainApplication` reads the **pending** → now **active** bundle path and loads it. Then `markSuccessfulLaunch()` promotes it from pending to active in SharedPreferences.

---

### F. Rollback Flow

```
Bundle crashes 3 times in a row (incrementCrashCount threshold)
        │
        ▼
otaStorage.rollback()
        │
        ├── previousBundlePath exists ──► setActiveBundlePath(previousPath)
        │
        └── no previous ──────────────► clearActiveBundlePath()  (fall back to APK asset)
        │
        ▼
resetCrashCount()
        │
        ▼
restartApp()  ──► loads previous bundle or APK asset
```

---

## State Machine — OTA Status

```
                     ┌──────────┐
                     │   IDLE   │
                     └────┬─────┘
                          │ checkForUpdate()
                          ▼
                     ┌──────────┐
                     │ CHECKING │
                     └────┬─────┘
              ┌───────────┴──────────┐
              │ hasUpdate: false     │ hasUpdate: true
              ▼                      ▼
        ┌───────────┐      ┌──────────────────┐
        │ UP_TO_DATE│      │ UPDATE_AVAILABLE  │
        └───────────┘      └────────┬─────────┘
                                    │ auto-download (BACKGROUND/IMMEDIATE)
                                    ▼
                           ┌──────────────┐
                           │ DOWNLOADING  │ ── progress: 0→100%
                           └──────┬───────┘
                     ┌────────────┴─────────────┐
                     │ success                  │ error
                     ▼                           ▼
            ┌─────────────────┐           ┌───────────┐
            │ READY_TO_INSTALL│           │   ERROR   │
            └────────┬────────┘           └───────────┘
                     │ applyNow() / restart
                     ▼
              ┌────────────┐
              │ INSTALLING │
              └────────────┘
                     │ crash × threshold
                     ▼
              ┌─────────────┐
              │ ROLLED_BACK │
              └─────────────┘
```

---

## Storage Layers

| What                   | Where                     | Access                   |
|------------------------|---------------------------|--------------------------|
| Active bundle path     | Android SharedPreferences | `OtaBundleManager` (Kotlin) + `OtaUpdateModule` (native bridge) |
| Pending bundle path    | Android SharedPreferences | Same                     |
| Previous bundle path   | Android SharedPreferences | Same (rollback target)   |
| Crash count            | Android SharedPreferences | Same                     |
| Release metadata       | SQLite (`ota.db`)         | OTA Server only          |
| Bundle ZIPs            | Local filesystem          | Server disk / device disk |
| In-session label cache | JS memory (`OtaStorage`)  | Derived from path on load |

---

## Key Design Decisions

### Why SharedPreferences for bundle paths?
The native `MainApplication` must know which bundle to load **before JS executes**. SharedPreferences is the only storage readable in Kotlin before the JS engine starts.

### Why `arrayBuffer()` instead of streaming?
React Native's Hermes engine does not implement the `ReadableStream` / `getReader()` API on `Response.body`. `response.arrayBuffer()` is fully supported and collects the full payload in memory before writing to disk.

### Why derive labels from paths?
Labels are not stored in SharedPreferences — only file paths are (to keep the native layer minimal). The JS layer derives the label from the directory name in the path (`.../ota/<label>/index.android.bundle`), avoiding any native schema changes.

### Why `created_at` comparison instead of `label !=`?
Label strings are not reliably sortable (e.g., "v1.0.10" < "v1.0.9" lexicographically). Using `created_at` timestamp of the current label as the comparison baseline ensures the device always gets the newest release published **after** its current one.

### Why AlarmManager for restart?
`ActivityManager.recreate()` only restarts the JS layer. A full cold-start restart (which re-executes `MainApplication` and re-selects the bundle path) requires killing and relaunching the process. AlarmManager schedules a delayed relaunch after `Process.killProcess()`.
