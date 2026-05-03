/**
 * OTA Update Server
 * ─────────────────
 * Express.js REST API for managing and serving OTA bundle updates.
 *
 * Routes:
 *   GET  /v1/check-update   — device polls for updates
 *   GET  /v1/download/:file — stream or redirect to a bundle ZIP
 *   POST /v1/report         — device reports install result
 *   GET  /v1/releases       — list releases (CLI/admin)
 *   POST /v1/releases       — publish a new release (CLI)
 *   DEL  /v1/releases/:id   — deactivate a release (CLI/admin)
 *
 * Environment variables (.env):
 *   PORT                    — default 3000
 *   OTA_SECRET              — secret key for CLI authentication (default: dev-secret)
 *   BASE_URL                — public base URL (default: http://localhost:PORT)
 *   DATABASE_URL            — PostgreSQL connection string (Supabase)
 *   STORAGE_BACKEND         — "supabase" | "local" (default: "local")
 *   SUPABASE_URL            — required when STORAGE_BACKEND=supabase
 *   SUPABASE_SERVICE_ROLE_KEY — required when STORAGE_BACKEND=supabase
 *   OTA_BUCKET_NAME         — Supabase bucket name (default: ota-bundles)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { checkUpdateRouter } from './routes/checkUpdate';
import { downloadRouter } from './routes/download';
import { reportRouter } from './routes/report';
import { releasesRouter } from './routes/releases';
import { LocalStorage, SupabaseStorage } from './storage';

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

// ─── Storage backend ──────────────────────────────────────────────────────────
const storage =
  process.env.STORAGE_BACKEND === 'supabase'
    ? new SupabaseStorage()
    : new LocalStorage(BASE_URL);

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// OTA routes
app.use('/v1/check-update', checkUpdateRouter(storage));
app.use('/v1/download',     downloadRouter(storage));
app.use('/v1/report',       reportRouter());
app.use('/v1/releases',     releasesRouter(storage));

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 OTA Server running at ${BASE_URL}`);
  console.log(`   Health:  ${BASE_URL}/health`);
  console.log(`   Storage: ${process.env.STORAGE_BACKEND === 'supabase' ? 'Supabase' : 'Local'}`);
  console.log(`   Secret:  ${process.env.OTA_SECRET ? '(set)' : 'dev-secret (set OTA_SECRET in .env)'}\n`);
});

export default app;
