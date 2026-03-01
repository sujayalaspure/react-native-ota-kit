/**
 * db.ts — SQLite database setup with better-sqlite3
 *
 * Schema:
 *   releases     — one row per published OTA bundle
 *   install_reports — device install status events
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'ota.db');

// Ensure the data directory exists
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS releases (
    id              TEXT PRIMARY KEY,          -- uuid
    label           TEXT NOT NULL UNIQUE,      -- semver or short id, e.g. "v1.2.3-patch1"
    app_version     TEXT NOT NULL,             -- minimum app version (semver range)
    channel         TEXT NOT NULL DEFAULT 'production',
    platform        TEXT NOT NULL,             -- 'android' | 'ios' | 'both'
    bundle_path     TEXT NOT NULL,             -- absolute path to the stored ZIP
    hash            TEXT NOT NULL,             -- SHA-256 of the ZIP
    size            INTEGER NOT NULL,          -- bytes
    mandatory       INTEGER NOT NULL DEFAULT 0,-- 0=false, 1=true
    active          INTEGER NOT NULL DEFAULT 1,-- 0=deactivated (auto or manual)
    rollback_rate   REAL NOT NULL DEFAULT 0,   -- 0–1, updated by reports
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS install_reports (
    id          TEXT PRIMARY KEY,
    release_id  TEXT NOT NULL REFERENCES releases(id),
    device_id   TEXT,
    platform    TEXT NOT NULL,
    status      TEXT NOT NULL,   -- 'installed' | 'rollback' | 'failed'
    app_version TEXT,
    reported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_releases_channel_platform
    ON releases (channel, platform, active, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_reports_release
    ON install_reports (release_id, status);
`);

// ─── Queries ──────────────────────────────────────────────────────────────────

export const queries = {
  /** Find the latest active release for a given channel + platform that
   *  supports the caller's appVersion and is newer than currentLabel.
   *  We compare created_at so that a device on v1.0.7 does NOT get offered
   *  v1.0.6 (which was published before v1.0.7). */
  findLatestRelease: db.prepare(`
    SELECT * FROM releases
    WHERE channel   = @channel
      AND (platform = @platform OR platform = 'both')
      AND active    = 1
      AND created_at > COALESCE(
            (SELECT created_at FROM releases WHERE label = @currentLabel),
            '1970-01-01'
          )
    ORDER BY created_at DESC
    LIMIT 1
  `),

  getReleaseById: db.prepare(
    `SELECT * FROM releases WHERE id = @id`
  ),

  getReleaseByLabel: db.prepare(
    `SELECT * FROM releases WHERE label = @label`
  ),

  insertRelease: db.prepare(`
    INSERT INTO releases (id, label, app_version, channel, platform, bundle_path, hash, size, mandatory)
    VALUES (@id, @label, @app_version, @channel, @platform, @bundle_path, @hash, @size, @mandatory)
  `),

  deactivateRelease: db.prepare(
    `UPDATE releases SET active = 0 WHERE id = @id`
  ),

  insertReport: db.prepare(`
    INSERT INTO install_reports (id, release_id, device_id, platform, status, app_version)
    VALUES (@id, @release_id, @device_id, @platform, @status, @app_version)
  `),

  /** Compute rollback rate for a release: rollbacks / (rollbacks + installs) */
  getRollbackRate: db.prepare(`
    SELECT
      CAST(SUM(CASE WHEN status = 'rollback' THEN 1 ELSE 0 END) AS REAL) /
      NULLIF(SUM(CASE WHEN status IN ('installed','rollback') THEN 1 ELSE 0 END), 0)
      AS rate
    FROM install_reports
    WHERE release_id = @release_id
  `),

  updateRollbackRate: db.prepare(
    `UPDATE releases SET rollback_rate = @rate WHERE id = @id`
  ),
};
