# Build & OTA CLI Commands — Documentation

This document describes all build and OTA CLI commands available in this project, including usage, parameters, and their purpose.

---

## Overview

The project uses Yarn workspaces and a custom CLI tool (`ota-cli`) for bundling, publishing, and managing OTA updates. All commands are run from the project root unless otherwise specified.

---

## Commands List

### 1. Start OTA Server
- **Command:** `yarn ota:server`
- **Purpose:** Start the OTA update server (Express)
- **Usage:**
  ```bash
  yarn ota:server
  ```
- **Params:** None
- **Notes:**
  - Uses `packages/ota-server/.env` for config
  - Default port: 3000

### 2. Bundle OTA Update
- **Command:** `yarn ota:bundle -- --label <label> --platform <platform>`
- **Purpose:** Create a new OTA bundle ZIP for a given label and platform
- **Usage:**
  ```bash
  yarn ota:bundle -- --label v1.0.7 --platform android
  ```
- **Params:**
  - `--label <label>`: Release label (e.g., v1.0.7) **[required]**
  - `--platform <platform>`: "android" or "ios" **[required]**
  - `--entry <file>`: Entry JS file (default: index.js)
  - `--output <dir>`: Output directory (default: ota-output)
- **Notes:**
  - Produces ZIP file in `ota-output/`
  - Computes SHA-256 hash

### 3. Publish OTA Update
- **Command:** `yarn ota:publish -- --label <label> --platform <platform> [options]`
- **Purpose:** Publish a bundled ZIP to the OTA server
- **Usage:**
  ```bash
  yarn ota:publish -- --label v1.0.7 --platform android --channel production --appVersion 1.0.0 --mandatory false
  ```
- **Params:**
  - `--label <label>`: Release label (e.g., v1.0.7) **[required]**
  - `--platform <platform>`: "android" or "ios" **[required]**
  - `--channel <channel>`: Release channel (default: production)
  - `--appVersion <version>`: App version constraint (default: >=1.0.0)
  - `--mandatory <true|false>`: Is update mandatory (default: false)
  - `--server <url>`: OTA server URL (default from ota.config.json)
  - `--secret <key>`: OTA secret (default from ota.config.json)
- **Notes:**
  - Requires server running and correct secret
  - Each label must be unique

### 4. List Releases
- **Command:** `yarn workspace ota-cli list`
- **Purpose:** List all releases on the OTA server
- **Usage:**
  ```bash
  yarn workspace ota-cli list
  ```
- **Params:**
  - `--server <url>`: OTA server URL
  - `--secret <key>`: OTA secret
- **Notes:**
  - Shows all releases for all platforms/channels

### 5. Clean Output
- **Command:** `yarn workspace ota-cli clean`
- **Purpose:** Remove all files from the output directory
- **Usage:**
  ```bash
  yarn workspace ota-cli clean
  ```
- **Params:**
  - `--output <dir>`: Output directory (default: ota-output)
- **Notes:**
  - Use before rebundling to avoid stale files

---

## Parameter Reference

| Param         | Command(s)         | Purpose                                      |
|---------------|--------------------|----------------------------------------------|
| `--label`     | bundle, publish    | Release label (unique per release)           |
| `--platform`  | bundle, publish    | Target platform: android or ios              |
| `--entry`     | bundle             | Entry JS file (default: index.js)            |
| `--output`    | bundle, clean      | Output directory for ZIP and assets          |
| `--channel`   | publish            | Release channel (e.g., production, staging)  |
| `--appVersion`| publish            | App version constraint (semver)              |
| `--mandatory` | publish            | Is update mandatory (true/false)             |
| `--server`    | publish, list      | OTA server URL                               |
| `--secret`    | publish, list      | OTA secret key for authentication            |

---

## Examples

### Bundle and Publish an Update
```bash
yarn ota:bundle -- --label v1.0.7 --platform android
yarn ota:publish -- --label v1.0.7 --platform android --channel production --appVersion 1.0.0 --mandatory false
```

### List All Releases
```bash
yarn workspace ota-cli list --server http://192.168.1.3:3000 --secret dev-secret
```

### Clean Output Directory
```bash
yarn workspace ota-cli clean --output ota-output
```

---

## Notes
- Always use a new label for each publish (labels must be unique)
- The server must be running before publishing
- All commands can be run from the project root
- For full options, run `yarn workspace ota-cli --help`
