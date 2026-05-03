/**
 * migrate.ts — Create tables on a fresh PostgreSQL database.
 *
 * Usage:
 *   DATABASE_URL=<your-supabase-url> npx ts-node src/migrate.ts
 *   or via package.json script:  npm run db:migrate
 */

import 'dotenv/config';
import { pool } from './db';

async function migrate() {
  console.log('Running migrations…');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS releases (
      id            TEXT        PRIMARY KEY,
      label         TEXT        NOT NULL UNIQUE,
      app_version   TEXT        NOT NULL,
      channel       TEXT        NOT NULL DEFAULT 'production',
      platform      TEXT        NOT NULL,
      bundle_path   TEXT        NOT NULL,
      hash          TEXT        NOT NULL,
      size          INTEGER     NOT NULL,
      mandatory     BOOLEAN     NOT NULL DEFAULT false,
      active        BOOLEAN     NOT NULL DEFAULT true,
      rollback_rate REAL        NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS install_reports (
      id          TEXT        PRIMARY KEY,
      release_id  TEXT        NOT NULL REFERENCES releases(id),
      device_id   TEXT,
      platform    TEXT        NOT NULL,
      status      TEXT        NOT NULL,
      app_version TEXT,
      reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_releases_channel_platform
      ON releases (channel, platform, active, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_reports_release
      ON install_reports (release_id, status);
  `);

  console.log('Migrations complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
