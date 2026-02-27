/**
 * POST /v1/releases
 * Used exclusively by the ota-cli to publish a new bundle.
 * Protected by the OTA_SECRET header.
 *
 * Multipart form fields:
 *   bundle       — the ZIP file
 *   label        — unique version label, e.g. "v1.2.3-patch1"
 *   appVersion   — semver range of compatible native versions, e.g. ">=1.0.0"
 *   channel      — deployment channel (default: "production")
 *   platform     — "android" | "ios" | "both"
 *   mandatory    — "true" | "false" (default: "false")
 *   hash         — expected SHA-256 of the ZIP (server verifies)
 *
 * GET /v1/releases
 * Lists all releases (most recent first), with optional ?channel= filter.
 *
 * DELETE /v1/releases/:id
 * Deactivates a release.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { queries } from '../db';
import type { StorageBackend } from '../storage';
import Database from 'better-sqlite3';

// In-memory multer storage so we can validate before writing to disk
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const OTA_SECRET = process.env.OTA_SECRET ?? 'dev-secret';

function authMiddleware(req: Request, res: Response, next: Function) {
  const secret = req.headers['x-ota-secret'];
  if (secret !== OTA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

export function releasesRouter(storage: StorageBackend): Router {
  const router = Router();

  // ── List releases ──────────────────────────────────────────────────────────
  router.get('/', authMiddleware, (req: Request, res: Response) => {
    const { channel } = req.query as Record<string, string>;
    const where = channel ? 'WHERE channel = ?' : '';
    const params = channel ? [channel] : [];
    // Use raw db for flexible query
    const { db } = require('../db');
    const rows = db
      .prepare(`SELECT * FROM releases ${where} ORDER BY created_at DESC`)
      .all(...params);
    return res.json({ releases: rows });
  });

  // ── Publish release ────────────────────────────────────────────────────────
  router.post(
    '/',
    authMiddleware,
    upload.single('bundle'),
    async (req: Request, res: Response) => {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: 'bundle file is required' });

      const { label, appVersion, channel = 'production', platform, mandatory = 'false', hash } = req.body;

      if (!label || !appVersion || !platform) {
        return res.status(400).json({ error: 'label, appVersion, platform are required' });
      }

      const validPlatforms = ['android', 'ios', 'both'];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ error: `platform must be one of: ${validPlatforms.join(', ')}` });
      }

      // Verify hash if provided
      if (hash) {
        const actual = createHash('sha256').update(file.buffer).digest('hex');
        if (actual !== hash) {
          return res.status(400).json({ error: `Hash mismatch. Expected: ${hash}, Got: ${actual}` });
        }
      }

      // Check label uniqueness
      const existing = queries.getReleaseByLabel.get({ label }) as any;
      if (existing) {
        return res.status(409).json({ error: `Release with label "${label}" already exists` });
      }

      const id = randomUUID();
      const fileName = `${label}-${platform}.zip`;
      const storedPath = await storage.save(fileName, file.buffer);
      const actualHash = createHash('sha256').update(file.buffer).digest('hex');

      queries.insertRelease.run({
        id,
        label,
        app_version: appVersion,
        channel,
        platform,
        bundle_path: storedPath,
        hash: actualHash,
        size: file.size,
        mandatory: mandatory === 'true' ? 1 : 0,
      });

      return res.status(201).json({
        release: {
          id,
          label,
          appVersion,
          channel,
          platform,
          hash: actualHash,
          size: file.size,
          mandatory: mandatory === 'true',
        },
      });
    },
  );

  // ── Deactivate release ─────────────────────────────────────────────────────
  router.delete('/:id', authMiddleware, (req: Request, res: Response) => {
    const { id } = req.params;
    const release = queries.getReleaseById.get({ id }) as any;
    if (!release) return res.status(404).json({ error: 'Release not found' });
    queries.deactivateRelease.run({ id });
    return res.json({ ok: true, message: `Release "${release.label}" deactivated` });
  });

  return router;
}
