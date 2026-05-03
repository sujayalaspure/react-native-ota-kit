/**
 * db.ts — PostgreSQL database access via node-postgres (pg)
 *
 * Schema:
 *   releases        — one row per published OTA bundle
 *   install_reports — device install status events
 *
 * Run `npm run db:migrate` (migrate.ts) to create tables on a fresh database.
 */

import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

// ─── Queries ──────────────────────────────────────────────────────────────────

export const queries = {
  /** Find the latest active release for a given channel + platform that
   *  supports the caller's appVersion and is newer than currentLabel.
   *  We compare created_at so that a device on v1.0.7 does NOT get offered
   *  v1.0.6 (which was published before v1.0.7). */
  findLatestRelease: async (params: { channel: string; platform: string; currentLabel: string }) => {
    const { rows } = await pool.query(
      `SELECT * FROM releases
       WHERE channel   = $1
         AND (platform = $2 OR platform = 'both')
         AND active    = true
         AND created_at > COALESCE(
               (SELECT created_at FROM releases WHERE label = $3),
               '1970-01-01'::timestamptz
             )
       ORDER BY created_at DESC
       LIMIT 1`,
      [params.channel, params.platform, params.currentLabel],
    );
    return rows[0] ?? null;
  },

  getReleaseById: async (id: string) => {
    const { rows } = await pool.query(
      `SELECT * FROM releases WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  getReleaseByLabel: async (label: string) => {
    const { rows } = await pool.query(
      `SELECT * FROM releases WHERE label = $1`,
      [label],
    );
    return rows[0] ?? null;
  },

  insertRelease: async (params: {
    id: string;
    label: string;
    app_version: string;
    channel: string;
    platform: string;
    bundle_path: string;
    hash: string;
    size: number;
    mandatory: number;
  }) => {
    await pool.query(
      `INSERT INTO releases (id, label, app_version, channel, platform, bundle_path, hash, size, mandatory)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.id, params.label, params.app_version, params.channel,
        params.platform, params.bundle_path, params.hash, params.size,
        params.mandatory === 1,
      ],
    );
  },

  deactivateRelease: async (id: string) => {
    await pool.query(`UPDATE releases SET active = false WHERE id = $1`, [id]);
  },

  insertReport: async (params: {
    id: string;
    release_id: string;
    device_id: string | null;
    platform: string;
    status: string;
    app_version: string | null;
  }) => {
    await pool.query(
      `INSERT INTO install_reports (id, release_id, device_id, platform, status, app_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.id, params.release_id, params.device_id, params.platform, params.status, params.app_version],
    );
  },

  /** Compute rollback rate for a release: rollbacks / (rollbacks + installs) */
  getRollbackRate: async (release_id: string): Promise<number> => {
    const { rows } = await pool.query(
      `SELECT
         CAST(SUM(CASE WHEN status = 'rollback' THEN 1 ELSE 0 END) AS FLOAT) /
         NULLIF(SUM(CASE WHEN status IN ('installed','rollback') THEN 1 ELSE 0 END), 0)
         AS rate
       FROM install_reports
       WHERE release_id = $1`,
      [release_id],
    );
    return rows[0]?.rate ?? 0;
  },

  updateRollbackRate: async (id: string, rate: number) => {
    await pool.query(`UPDATE releases SET rollback_rate = $1 WHERE id = $2`, [rate, id]);
  },

  listReleases: async (channel?: string) => {
    if (channel) {
      const { rows } = await pool.query(
        `SELECT * FROM releases WHERE channel = $1 ORDER BY created_at DESC`,
        [channel],
      );
      return rows;
    }
    const { rows } = await pool.query(`SELECT * FROM releases ORDER BY created_at DESC`);
    return rows;
  },
};
