/**
 * Information about the running server.
 *
 * Routes (mounted at /api/about):
 *
 *   GET /  → ApiOk<AboutInfo>
 */
import { Router } from 'express';
import type { AboutInfo, ApiOk } from '@kassandra/shared';
import { getAppVersion } from '../config/version.js';

export const aboutRouter = Router();

aboutRouter.get('/', (_req, res) => {
  const body: ApiOk<AboutInfo> = { ok: true, data: { version: getAppVersion() } };
  res.json(body);
});
