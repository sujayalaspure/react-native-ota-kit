# OTA Server — Documentation

This document describes the OTA (Over-the-Air) update server component for the React Native OTA framework. It covers API endpoints, request/response formats, database schema, and workflow.

---

## Overview

The OTA server manages update bundles for mobile apps, allowing clients to check for updates, download bundles, and report install status. It is built with Express.js and uses SQLite for persistent storage.

---

## API Endpoints

### 1. Health Check
  - **Purpose:** Server status
  - **Request:** None
  - **Response:** `{ "status": "ok", "ts": "<timestamp>" }`
- **GET /health**
  - **Purpose:** Server status
  - **Request:** None
  - **Example Request:**
    ```http
    GET /health
    ```
  - **Example Response:**
    ```json
    { "status": "ok", "ts": "2026-02-28T00:00:00.000Z" }
    ```

### 2. Check for Update
  - **Purpose:** Check if a new update is available for the client
  - **Request Query Params:**
    - `appVersion` (string): App version (e.g., "1.0.0")
    - `currentLabel` (string): Currently installed bundle label (e.g., "v1.0.6")
    - `platform` (string): "android" or "ios"
    - `channel` (string): Release channel (e.g., "production")
  - **Response:**
    - **Success:**
      ```json
      {
        "hasUpdate": true,
        "release": {
          "id": "<uuid>",
          "label": "v1.0.7",
          "platform": "android",
          "size": 377900,
          "hash": "<sha256>",
          "mandatory": false,
          "downloadUrl": "http://<server>/v1/download/v1.0.7-android.zip"
        }
      }
      ```
    - **No Update:** `{ "hasUpdate": false }`
    - **Error:** `{ "error": "Invalid request" }`
- **GET /v1/check-update**
  - **Purpose:** Check if a new update is available for the client
  - **Request Query Params:**
    - `appVersion` (string): App version (e.g., "1.0.0")
    - `currentLabel` (string): Currently installed bundle label (e.g., "v1.0.6")
    - `platform` (string): "android" or "ios"
    - `channel` (string): Release channel (e.g., "production")
  - **Example Request:**
    ```http
    GET /v1/check-update?appVersion=1.0.0&currentLabel=v1.0.6&platform=android&channel=production
    ```
  - **Example Success Response:**
    ```json
    {
      "hasUpdate": true,
      "release": {
        "id": "dcae4096e82d232bc3a5ef9d87b65f1a675b04c9",
        "label": "v1.0.7",
        "platform": "android",
        "size": 377900,
        "hash": "a97480ff0e41faaec060aef625d4289ba49196897837c6906d4cb8826d412145",
        "mandatory": false,
        "downloadUrl": "http://192.168.1.3:3000/v1/download/v1.0.7-android.zip"
      }
    }
    ```
  - **Example No Update Response:**
    ```json
    { "hasUpdate": false }
    ```
  - **Example Error Response:**
    ```json
    { "error": "Invalid request" }
    ```

### 3. Download Bundle
  - **Purpose:** Download the update ZIP file
  - **Request:**
    - URL param: `filename` (e.g., `v1.0.7-android.zip`)
    - Header: `x-ota-secret` (string, required)
  - **Response:**
    - **Success:** ZIP file (Content-Type: application/zip)
    - **Error:** `{ "error": "Not found" }`
- **GET /v1/download/:filename**
  - **Purpose:** Download the update ZIP file
  - **Request:**
    - URL param: `filename` (e.g., `v1.0.7-android.zip`)
    - Header: `x-ota-secret` (string, required)
  - **Example Request:**
    ```http
    GET /v1/download/v1.0.7-android.zip
    x-ota-secret: dev-secret
    ```
  - **Example Success Response:**
    (ZIP file streamed)
  - **Example Error Response:**
    ```json
    { "error": "Not found" }
    ```

### 4. Publish Release
  - **Purpose:** Upload a new bundle release
  - **Request:**
    - Form-data:
      - `label` (string): Release label (e.g., "v1.0.7")
      - `platform` (string): "android" or "ios"
      - `channel` (string): Release channel
      - `appVersion` (string): App version
      - `mandatory` (boolean): Is update mandatory
      - `file` (file): ZIP bundle
      - Header: `x-ota-secret` (string, required)
  - **Response:**
    - **Success:** `{ "success": true, "id": "<uuid>" }`
    - **Error:** `{ "error": "Label already exists" }`
- **POST /v1/publish**
  - **Purpose:** Upload a new bundle release
  - **Request:**
    - Form-data:
      - `label` (string): Release label (e.g., "v1.0.7")
      - `platform` (string): "android" or "ios"
      - `channel` (string): Release channel
      - `appVersion` (string): App version
      - `mandatory` (boolean): Is update mandatory
      - `file` (file): ZIP bundle
      - Header: `x-ota-secret` (string, required)
  - **Example Request (curl):**
    ```bash
    curl -X POST http://192.168.1.3:3000/v1/publish \
      -H "x-ota-secret: dev-secret" \
      -F "label=v1.0.7" \
      -F "platform=android" \
      -F "channel=production" \
      -F "appVersion=1.0.0" \
      -F "mandatory=false" \
      -F "file=@v1.0.7-android.zip"
    ```
  - **Example Success Response:**
    ```json
    { "success": true, "id": "dcae4096e82d232bc3a5ef9d87b65f1a675b04c9" }
    ```
  - **Example Error Response:**
    ```json
    { "error": "Label already exists" }
    ```

### 5. List Releases
  - **Purpose:** List all published releases
  - **Request:** Header: `x-ota-secret` (string, required)
  - **Response:**
    - **Success:** Array of releases
    - **Error:** `{ "error": "Unauthorized" }`
- **GET /v1/releases**
  - **Purpose:** List all published releases
  - **Request:** Header: `x-ota-secret` (string, required)
  - **Example Request:**
    ```http
    GET /v1/releases
    x-ota-secret: dev-secret
    ```
  - **Example Success Response:**
    ```json
    [
      {
        "id": "dcae4096e82d232bc3a5ef9d87b65f1a675b04c9",
        "label": "v1.0.7",
        "platform": "android",
        "channel": "production",
        "appVersion": "1.0.0",
        "size": 377900,
        "hash": "a97480ff0e41faaec060aef625d4289ba49196897837c6906d4cb8826d412145",
        "mandatory": false,
        "filePath": "/path/to/v1.0.7-android.zip",
        "createdAt": "2026-02-28T00:00:00.000Z"
      }
    ]
    ```
  - **Example Error Response:**
    ```json
    { "error": "Unauthorized" }
    ```

### 6. Report Install Status
  - **Purpose:** Client reports install/rollback/failure
  - **Request:**
    - JSON body:
      - `releaseId` (string): Release UUID
      - `status` (string): "installed" | "rollback" | "failed"
      - `platform` (string): "android" or "ios"
      - `appVersion` (string): App version
    - Header: `x-ota-secret` (string, required)
  - **Response:** `{ "success": true }` or `{ "error": "Invalid release" }`
- **POST /v1/report**
  - **Purpose:** Client reports install/rollback/failure
  - **Request:**
    - JSON body:
      - `releaseId` (string): Release UUID
      - `status` (string): "installed" | "rollback" | "failed"
      - `platform` (string): "android" or "ios"
      - `appVersion` (string): App version
    - Header: `x-ota-secret` (string, required)
  - **Example Request:**
    ```http
    POST /v1/report
    x-ota-secret: dev-secret
    Content-Type: application/json

    {
      "releaseId": "dcae4096e82d232bc3a5ef9d87b65f1a675b04c9",
      "status": "installed",
      "platform": "android",
      "appVersion": "1.0.0"
    }
    ```
  - **Example Success Response:**
    ```json
    { "success": true }
    ```
  - **Example Error Response:**
    ```json
    { "error": "Invalid release" }
    ```

---

## Database Schema (SQLite)

### Table: releases
| Column      | Type    | Description                  |
|-------------|---------|------------------------------|
| id          | TEXT    | UUID (primary key)           |
| label       | TEXT    | Release label (unique)       |
| platform    | TEXT    | "android" or "ios"           |
| channel     | TEXT    | Release channel              |
| appVersion  | TEXT    | App version                  |
| size        | INTEGER | Bundle size (bytes)          |
| hash        | TEXT    | SHA-256 of ZIP               |
| mandatory   | INTEGER | 0/1 (boolean)                |
| filePath    | TEXT    | Filesystem path to ZIP       |
| createdAt   | TEXT    | ISO timestamp                |

### Table: install_reports
| Column      | Type    | Description                  |
|-------------|---------|------------------------------|
| id          | TEXT    | UUID (primary key)           |
| releaseId   | TEXT    | Release UUID (foreign key)   |
| status      | TEXT    | "installed" | "rollback" | "failed" |
| platform    | TEXT    | "android" or "ios"           |
| appVersion  | TEXT    | App version                  |
| reportedAt  | TEXT    | ISO timestamp                |

---

## Workflow

1. **Publish:**
   - Admin uploads a new bundle via `/v1/publish`.
   - Server saves ZIP, computes hash, stores metadata in `releases` table.

2. **Check for Update:**
   - Client calls `/v1/check-update` with current label, app version, platform, channel.
   - Server compares latest release for channel/platform/appVersion.
   - If newer label exists, returns release info; else, `hasUpdate: false`.

3. **Download:**
   - Client downloads ZIP from `/v1/download/:filename`.
   - Server streams ZIP file if authorized.

4. **Apply:**
   - Client verifies hash, extracts bundle, marks as pending.
   - On next cold start, bundle is activated.

5. **Report:**
   - Client POSTs install status to `/v1/report`.
   - Server records in `install_reports` table.

6. **List Releases:**
   - Admin can list all releases via `/v1/releases`.

---

## Error Handling
- All endpoints return `{ "error": "<message>" }` on failure.
- 401 Unauthorized if `x-ota-secret` is missing or invalid.
- 404 Not Found for missing files/releases.
- 400 Bad Request for invalid parameters.

---

## Security
- All write and download endpoints require `x-ota-secret` header.
- Use strong secrets in production and HTTPS for transport security.

---

## Environment Variables
- `PORT`: Server port (default: 3000)
- `OTA_SECRET`: Secret key for API authentication
- `BASE_URL`: Public base URL for download links

---

## Notes
- Bundles must be ZIP files containing `index.android.bundle` (Android) or `main.jsbundle` (iOS), plus assets.
- Each label must be unique per platform/channel.
- Server supports multiple channels (e.g., production, staging).
