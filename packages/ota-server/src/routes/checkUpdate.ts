/**
 * GET /v1/check-update
 *
 * Query params:
 *   appVersion   — semver of the installed native app, e.g. "1.0.0"
 *   currentLabel — label of the bundle currently running (or empty string)
 *   platform     — "android" | "ios"
 *   channel      — "production" | "staging" | custom
 *
 * Response:
 *   { hasUpdate: false }
 *   { hasUpdate: true, release: { id, label, downloadUrl, hash, size, mandatory, ... } }
 */

import { Router, Request, Response } from 'express';
import semver from 'semver';
import { queries } from '../db';
import type { StorageBackend } from '../storage';

export function checkUpdateRouter(storage: StorageBackend): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const { appVersion, currentLabel = '', platform, channel = 'production' } = req.query as Record<string, string>;

    if (!appVersion || !platform) {
      return res.status(400).json({ error: 'appVersion and platform are required' });
    }

    const release = queries.findLatestRelease.get({
      channel,
      platform,
      currentLabel,
    }) as any;

    if (!release) {
      return res.json({ hasUpdate: false });
    }

    // Check minimum app version: release.app_version is a semver range
    // e.g. ">=1.0.0" — device must satisfy it to receive this update
    if (release.app_version && !semver.satisfies(appVersion, release.app_version)) {
      return res.json({ hasUpdate: false });
    }

    const downloadUrl = storage.getDownloadUrl(release.bundle_path, req);

    return res.json({
      hasUpdate: true,
      release: {
        id: release.id,
        label: release.label,
        downloadUrl,
        hash: release.hash,
        size: release.size,
        mandatory: Boolean(release.mandatory),
        minAppVersion: release.app_version,
        platform: release.platform,
        channel: release.channel,
        createdAt: release.created_at,
      },
    });
  });

  return router;
}
