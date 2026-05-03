/**
 * POST /v1/report
 * Called by the app after a bundle installs, fails, or rolls back.
 * Used to compute rollback rates and auto-deactivate bad releases.
 *
 * Body JSON:
 *   { releaseId, status: 'installed'|'rollback'|'failed', platform, appVersion, deviceId? }
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { queries } from '../db';

// Auto-deactivate a release if rollback rate exceeds this threshold
const AUTO_DEACTIVATE_THRESHOLD = 0.3; // 30%

export function reportRouter(): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const { releaseId, status, platform, appVersion, deviceId } = req.body;

    if (!releaseId || !status || !platform) {
      return res.status(400).json({ error: 'releaseId, status, platform are required' });
    }

    const validStatuses = ['installed', 'rollback', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const release = await queries.getReleaseById(releaseId);
    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }

    // Insert report
    await queries.insertReport({
      id: randomUUID(),
      release_id: releaseId,
      device_id: deviceId ?? null,
      platform,
      status,
      app_version: appVersion ?? null,
    });

    // Recompute rollback rate and potentially auto-deactivate
    const rate = await queries.getRollbackRate(releaseId);
    await queries.updateRollbackRate(releaseId, rate);

    if (rate >= AUTO_DEACTIVATE_THRESHOLD && release.active === true) {
      await queries.deactivateRelease(releaseId);
      console.warn(
        `[OtaServer] Release "${release.label}" auto-deactivated: rollback rate ${(rate * 100).toFixed(1)}%`,
      );
    }

    return res.json({ ok: true });
  });

  return router;
}
