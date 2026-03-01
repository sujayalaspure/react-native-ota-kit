# RNAppOta — Custom OTA Update Framework

A full-stack Over-the-Air (OTA) update system for React Native, built from scratch. No CodePush, no Expo Updates — just native modules, a lightweight server, and a CLI tool wired together.

---

## What Is This?

This project is both:

1. **A working React Native app** (RN 0.84, New Architecture, Hermes) that can receive and apply JS bundle updates without going through the App Store or Play Store.
2. **The OTA framework itself** — the server, SDK, and CLI tools that power those updates.

It works similarly to Microsoft CodePush: you bundle your JS, push it to a server, and the app downloads + applies it silently in the background. The key difference is you own every piece of it.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Monorepo Root                          │
│                                                             │
│  ┌──────────────┐  ┌─────────────────┐  ┌───────────────┐   │
│  │  RN App      │  │ packages/       │  │ tools/        │   │
│  │  (root)      │  │   ota-sdk/      │  │   ota-cli/    │   │
│  │              │  │   ota-server/   │  │               │   │
│  └──────────────┘  └─────────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Package | Role |
|---|---|
| **Root RN app** | The React Native app. Integrates the SDK via `OtaProvider`. |
| `packages/ota-sdk` | JS/TS SDK — check for updates, download, apply, crash guard. |
| `packages/ota-server` | Express server — stores releases, serves bundles, tracks installs. |
| `tools/ota-cli` | CLI tool — bundles JS, zips with assets, publishes to the server. |

### Native Modules

The SDK talks to native code on both platforms to do things JS can't do alone:

- **Write files to disk** — save the downloaded ZIP and extracted bundle
- **Verify SHA-256 hash** — confirm the download isn't corrupted
- **Unzip the bundle** — extract the ZIP into the OTA directory
- **Restart the app** — reload with the new bundle (Android: `AlarmManager` + `Process.killProcess`; iOS: `RCTTriggerReloadCommandListeners`)

**Android** — Kotlin (`OtaUpdateModule`, `OtaBundleManager`)  
The active bundle path is passed to `getDefaultReactHost()` as `jsBundleFilePath`. Falls back to the APK's asset bundle if no OTA bundle exists.

**iOS** — Swift (`OtaUpdateModule`, `OtaBundleManager`) + ObjC bridge  
The `bundleURL()` method in `AppDelegate.swift` checks `OtaBundleManager.shared.activeBundleURL` first, falling back to the built-in `main.jsbundle`.

---

## How It Works — Step by Step

```
Developer                CLI               OTA Server            User's Device
    │                      │                     │                          │
    │── yarn ota:bundle ──▶│                     │                          │
    │   (react-native      │                     │                          │
    │    bundle + zip)     │                     │                          │
    │                      │                     │                          │
    │── yarn ota:publish ─▶│── POST /v1/releases▶│                          │
    │                      │  (ZIP + metadata)   │                          │
    │                      │                     │                          │
    │                      │                     │◀── GET /v1/check-update  │
    │                      │                     │    (on app cold start    │
    │                      │                     │     or resume)           │
    │                      │                     │                          │
    │                      │                     │── { hasUpdate: true }-▶  │
    │                      │                     │                          │
    │                      │                     │◀── GET /v1/download/:file│
    │                      │                     │── ZIP stream ───────▶.   │
    │                      │                     │                      .   │
    │                      │                     │         verify SHA-256   │
    │                      │                     │         unzip bundle     │
    │                      │                     │         mark pending     │
    │                      │                     │                          │
    │                      │                     │    [next cold start]     │
    │                      │                     │         load new         │
    │                      │                     │         bundle ──────▶   │ ✅
```

### Update Strategies

Configure in `App.tsx` via the `OtaProvider` `strategy` prop:

| Strategy | Behavior |
|---|---|
| `BACKGROUND` *(default)* | Downloads silently. New bundle loads on the next cold start. |
| `IMMEDIATE` | Downloads, then immediately restarts the app with the new bundle. |
| `ON_RESUME` | Applies a pending bundle when the user brings the app back to the foreground. |

### Rollback & Crash Guard

Every cold start increments a crash counter. If the app crashes 3 consecutive times before calling `markSuccessfulLaunch()`, it automatically rolls back to the previous bundle and restarts.

On the server side, if more than **30%** of install reports for a release are rollbacks, the release is automatically deactivated — no new devices will receive it.

---

## Project Structure

```
RN-app-ota/
├── android/                     # Android native project
│   └── app/src/main/java/com/rnappota/ota/
│       ├── OtaBundleManager.kt  # Persists active/pending bundle paths
│       ├── OtaUpdateModule.kt   # Native methods exposed to JS
│       └── OtaUpdatePackage.kt  # Registers the module with RN
│
├── ios/RNAppOta/
│   ├── OtaBundleManager.swift   # Persists active/pending bundle paths
│   ├── OtaUpdateModule.swift    # Native methods exposed to JS
│   ├── OtaUpdateModule.m        # ObjC bridge
│   └── AppDelegate.swift        # Overrides bundleURL() for OTA
│
├── packages/
│   ├── ota-sdk/src/
│   │   ├── types.ts             # Shared TypeScript types
│   │   ├── OtaNativeModule.ts   # JS proxy over the native module
│   │   ├── OtaStorage.ts        # Manages active/pending bundle state
│   │   ├── OtaClient.ts         # HTTP client — check, download, apply
│   │   ├── OtaUpdater.tsx       # React context + useOtaUpdate() hook
│   │   ├── crashGuard.ts        # Crash detection + auto rollback
│   │   └── index.ts             # Public API
│   │
│   └── ota-server/src/
│       ├── server.ts            # Express app entry point (port 3000)
│       ├── db.ts                # SQLite (better-sqlite3) + queries
│       ├── storage.ts           # File storage for uploaded ZIPs
│       └── routes/
│           ├── checkUpdate.ts   # GET  /v1/check-update
│           ├── download.ts      # GET  /v1/download/:file
│           ├── report.ts        # POST /v1/report
│           └── releases.ts      # CRUD /v1/releases
│
├── tools/
│   └── ota-cli/src/
│       ├── commands/bundle.ts   # `ota bundle` — react-native bundle + zip
│       └── commands/publish.ts  # `ota publish` — upload ZIP to server
│
├── ota.config.json              # CLI config (server URL, secret, channel)
├── start-ota-server.js          # Server launcher (used by yarn ota:server)
├── App.tsx                      # Root component — wraps with OtaProvider
└── index.js                     # Entry point — initializes crash guard
```

---

## Prerequisites

- Node.js >= 22 (via nvm recommended)
- Yarn 1.x classic
- React Native development environment ([official guide](https://reactnative.dev/docs/set-up-your-environment))
  - Android Studio + emulator, or a physical Android device
  - Xcode (macOS only) for iOS

---

## Getting Started

### 1. Install dependencies

```bash
yarn install
```

### 2. Start the OTA server

```bash
yarn ota:server
```

The server starts at `http://localhost:3000`. Verify it's running:

```bash
curl http://localhost:3000/health
# → {"status":"ok","ts":"..."}
```

> The server must be running before you run `yarn ota:publish`.

### 3. Run the app

**Android:**
```bash
yarn android
```

**iOS** (first time — install pods):
```bash
bundle install
bundle exec pod install
yarn ios
```

### 4. Start Metro (standalone)

```bash
yarn start
```

---

## Pushing an OTA Update

This is the developer workflow for shipping a JS change to users without a native rebuild.

### Step 1 — Edit your JS

Change anything in `App.tsx` or any other JS/TS file.

### Step 2 — Bundle

```bash
# Android
yarn ota:bundle -- --label v1.0.2 --platform android

# iOS
yarn ota:bundle -- --label v1.0.2 --platform ios

# Both at once
yarn ota:bundle -- --label v1.0.2 --platform android,ios
```

Output goes to `ota-output/v1.0.2-android.zip` (and/or `ios.zip`).

| Flag | Default | Description |
|---|---|---|
| `--label` | *(required)* | Version label, e.g. `v1.0.2` |
| `--platform` | *(required)* | `android`, `ios`, or `android,ios` |
| `--entry` | `index.js` | Entry file |
| `--out` | `ota-output` | Output directory |

### Step 3 — Publish

> Make sure `yarn ota:server` is running first.

```bash
yarn ota:publish -- --label v1.0.2 --platform android
```

This uploads the ZIP to the OTA server using the settings from `ota.config.json`.

> **Note:** `yarn ota:publish` maps to `yarn workspace ota-cli release` internally. Do **not** run `yarn workspace ota-cli publish` directly — that triggers yarn's built-in npm publish flow.

### Step 4 — Verify

```bash
curl "http://localhost:3000/v1/check-update?appVersion=1.0.0&platform=android&channel=production"
# → { "hasUpdate": true, "release": { ... } }
```

---

## Server API

All routes are prefixed with `/v1`. Protected routes require the `x-ota-secret` header matching `.env -> OTA_SECRET`.

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check |
| `GET` | `/v1/check-update` | No | Check if an update is available |
| `GET` | `/v1/download/:file` | No | Download a ZIP bundle |
| `POST` | `/v1/report` | No | Report install success or rollback |
| `GET` | `/v1/releases` | Yes | List all releases |
| `POST` | `/v1/releases` | Yes | Upload a new release |
| `DELETE` | `/v1/releases/:id` | Yes | Deactivate a release |

---

## Configuration

### `ota.config.json` (used by the CLI for bundling and publishing)

```json
{
  "serverUrl": "http://192.168.1.3:3000",
  "secret": "dev-secret",
  "channel": "production",
  "appVersion": ">=1.0.0"
}
```

Update `serverUrl` to your machine's LAN IP. Find it with:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Also update `BASE_URL` in `packages/ota-server/.env` to the same IP so download URLs
generated by the server are reachable from the phone:
```
BASE_URL=http://192.168.1.3:3000
```

### `App.tsx` — OtaProvider (used by the running app)

```tsx
<OtaProvider config={{
  serverUrl: 'http://192.168.1.3:3000', // your machine's LAN IP
  channel: 'production',
  appVersion: '1.0.0',
  strategy: 'BACKGROUND',              // BACKGROUND | IMMEDIATE | ON_RESUME
}}>
```

| Device | serverUrl |
|---|---|
| Android emulator | `http://10.0.2.2:3000` |
| Physical device (same Wi-Fi) | `http://<your-LAN-IP>:3000` |
| iOS simulator | `http://localhost:3000` |

> When you change `serverUrl` in App.tsx you need to rebuild the native APK (`./gradlew assembleRelease`), because this value is baked into the JS bundle at build time.

---

## Building a Release APK

After making changes to `serverUrl` in `App.tsx` or any native code, rebuild the APK:

```bash
cd android && ./gradlew assembleRelease
```

The APK is output to:
```
android/app/build/outputs/apk/release/app-release.apk
```

Install on a connected device:
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

> The release build uses the debug keystore by default — fine for development and sideloading. For Play Store distribution, generate a proper keystore per the [React Native signing guide](https://reactnative.dev/docs/signed-apk-android).

---

## Debugging

### In-app update banner

The app shows a banner at the top for every stage of the update lifecycle:

| Status | Colour | Message |
|---|---|---|
| Checking | 🔵 Blue | "Checking for updates…" |
| Downloading | 🟡 Amber | "Downloading update…" + progress bar |
| Ready to install | 🟢 Green | "Update ready — restart to apply" + Restart button |
| Installing | 🟣 Purple | "Installing update, restarting…" |
| Error | 🔴 Red | "Update failed: \<reason\>" |
| Rolled back | 🔴 Red | "Update rolled back" |

### JS logs (Metro / Flipper)

All SDK steps log with the `[OTA]` prefix:
```
[OTA] Status → CHECKING
[OTA] Checking for update — channel: production, platform: android, appVersion: 1.0.0
[OTA] Update available — label: v1.0.2, size: 376.1 KB, mandatory: false
[OTA] Status → DOWNLOADING (v1.0.2)
[OTA] Downloading v1.0.2 — 25% ...
[OTA] Hash verified OK.
[OTA] Bundle extracted — path: ...index.android.bundle
[OTA] Status → READY_TO_INSTALL
```

### Android native logs (adb logcat)

Filter by the `OTA` tag to see native-layer events:
```bash
adb logcat -s OTA
```
```
OTA  D  No active OTA bundle — loading from APK asset.
 OTA  D  writeBase64File — wrote 385029 bytes to .../update.zip
OTA  D  sha256File — result: eac5894...
OTA  D  unzipFile — extracted 3 files to .../ota/v1.0.2
OTA  D  Active OTA bundle: .../ota/v1.0.2/index.android.bundle
```

---

## Rollback

Rollback is fully automatic — no user action required:

- **Crash guard:** 3 consecutive crashes -> the app reverts to the previous bundle on the next start.
- **Manual deactivation:** `DELETE /v1/releases/:id` stops new devices from receiving a bad release.
- **Auto-deactivation:** The server deactivates any release where >= 30% of install reports are rollbacks.

---

## How Users Get Updates

Users do **nothing**. The update cycle happens entirely in the background:

1. App opens — `OtaProvider` silently calls `/v1/check-update`.
2. If an update is available, it downloads in the background with no UI interruption.
3. The bundle is hash-verified, extracted, and staged as "pending".
4. On the next cold start, the new bundle loads automatically.
5. If the new bundle causes crashes, the crash guard rolls back — the user never sees a broken state.
