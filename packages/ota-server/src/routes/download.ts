/**
 * GET /v1/download/:fileName
 * Streams the bundle ZIP directly from local storage.
 * For S3: this route would redirect to a pre-signed URL instead.
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { StorageBackend } from '../storage';

export function downloadRouter(storage: StorageBackend): Router {
  const router = Router();

  router.get('/:fileName', (req: Request, res: Response) => {
    const { fileName } = req.params;

    // Security: strip any path traversal
    const safeFileName = path.basename(fileName);
    const localPath = storage.getLocalPath(safeFileName);

    if (!localPath) {
      // Remote storage (S3): should not reach here — check-update gives pre-signed URLs
      return res.status(404).json({ error: 'Not found' });
    }

    // Reconstruct full local path from just the filename
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    const filePath = path.join(uploadsDir, safeFileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);

    fs.createReadStream(filePath).pipe(res);
  });

  return router;
}
