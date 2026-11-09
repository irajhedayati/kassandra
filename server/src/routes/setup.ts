/**
 * First-run state and the configuration location.
 *
 * Routes (mounted at /api/setup):
 *
 *   GET /               → ApiOk<SetupInfo>
 *   PUT /location       → body: { location: string } → ApiOk<ChangeLocationResult>
 *   PUT /storage        → body: ChangeStorageRequest → ApiOk<ChangeLocationResult>
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ApiOk, ChangeLocationResult, SetupInfo } from '@kassandra/shared';
import { LocationError } from '../config/location.js';
import { changeLocation, changeStorage, getSetupInfo } from '../config/setup.js';

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

const storageSchema = z.object({
  backend: z.enum(['file', 'sqlite', 'postgres', 'mysql', 'firestore']),
  sqlitePath: z.string().optional(),
  sql: z
    .object({
      host: z.string(),
      port: z.number().int(),
      database: z.string(),
      username: z.string(),
      password: z.string().optional(),
      ssl: z.boolean(),
      schema: z.string().optional(),
    })
    .optional(),
  firestore: z
    .object({
      projectId: z.string().optional(),
      collection: z.string().optional(),
      credentials: z.string().optional(),
    })
    .optional(),
  migrate: z.boolean().optional(),
});

setupRouter.put('/storage', async (req, res) => {
  const parsed = storageSchema.safeParse(req.body);
  if (!parsed.success) throw new LocationError('Body must be { backend: "file" | "sqlite" | "postgres" | "mysql" | "firestore", sqlitePath?, sql?, firestore?, migrate? }', 400);
  const body: ApiOk<ChangeLocationResult> = { ok: true, data: await changeStorage(parsed.data) };
  res.json(body);
});
