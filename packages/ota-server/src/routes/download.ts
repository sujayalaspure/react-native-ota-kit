/**
 * GET /v1/download/:fileName
 *
 * - Local storage:   streams the ZIP directly from ./uploads/
 * - Remote storage:  redirects (302) to the public Supabase Storage URL
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { queries } from '../db';
import type { StorageBackend } from '../storage';

export function downloadRouter(storage: StorageBackend): Router {
  const router = Router();

  router.get('/:fileName', async (req: Request, res: Response) => {
    const { fileName } = req.params;

    // Security: strip any path traversal
    const safeFileName = path.basename(fileName);

    // Look up the release so we can get the stored key (works for both local and remote)
    // fileName format: <label>-<platform>.zip  — find by bundle_path ending with this name
    const { pool } = require('../db');
    const { rows } = await pool.query(
      `SELECT bundle_path FROM releases WHERE bundle_path LIKE $1 LIMIT 1`,
      [`%${safeFileName}`],
    );
    const storedKey: string | undefined = rows[0]?.bundle_path;

    // ── Remote storage (Supabase): redirect to public URL ────────────────────
    const localPath = storedKey ? storage.getLocalPath(storedKey) : null;
    if (!localPath) {
      if (!storedKey) return res.status(404).json({ error: 'File not found' });
      return res.redirect(302, storage.getDownloadUrl(storedKey));
    }

    // ── Local storage: stream directly ──────────────────────────────────────
    if (!fs.existsSync(localPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(localPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    fs.createReadStream(localPath).pipe(res);
  });

  return router;
}
