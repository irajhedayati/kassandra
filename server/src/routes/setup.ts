/**
 * First-run state and the configuration location.
 *
 * Routes (mounted at /api/setup):
 *
 *   GET /               → ApiOk<SetupInfo>
 *   PUT /location       → body: { location: string } → ApiOk<ChangeLocationResult>
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ApiOk, ChangeLocationResult, SetupInfo } from '@kassandra/shared';
import { LocationError } from '../config/location.js';
import { changeLocation, getSetupInfo } from '../config/setup.js';

export const setupRouter = Router();

setupRouter.get('/', (_req, res) => {
  const body: ApiOk<SetupInfo> = { ok: true, data: getSetupInfo() };
  res.json(body);
});

const locationSchema = z.object({ location: z.string() });

setupRouter.put('/location', async (req, res) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) throw new LocationError('Body must be { location: string }', 400);
  const body: ApiOk<ChangeLocationResult> = { ok: true, data: await changeLocation(parsed.data.location) };
  res.json(body);
});
