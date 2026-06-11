/**
 * Connection profile management + connect/disconnect.
 *
 * Routes (mounted at /api/profiles):
 *
 *   GET    /              → list profiles                    ApiOk<ConnectionProfile[]>
 *   POST   /              → create profile (body: profile)    ApiOk<ConnectionProfile>
 *   PUT    /:name         → update profile (body: profile)    ApiOk<ConnectionProfile>
 *   DELETE /:name         → delete profile                   ApiOk<{ deleted: string }>
 *   POST   /connect       → body: { name }                    ApiOk<ConnectionStatus>
 *   POST   /disconnect    →                                    ApiOk<ConnectionStatus>
 *   GET    /status        →                                    ApiOk<ConnectionStatus>
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ConnectionProfile } from '@py-sandra/shared';
import {
  deleteProfile as deleteProfileFromStore,
  getProfile,
  listProfiles,
  setLastConnection,
  upsertProfile,
} from '../config/store.js';
import { connect, disconnect, status } from '../cassandra/connection.js';

export const connectionRouter = Router();

const ConsistencyLevelSchema = z.enum([
  'ANY',
  'ONE',
  'TWO',
  'THREE',
  'QUORUM',
  'ALL',
  'LOCAL_QUORUM',
  'EACH_QUORUM',
  'SERIAL',
  'LOCAL_SERIAL',
  'LOCAL_ONE',
]);

const SslProtocolSchema = z.enum([
  'PROTOCOL_TLS',
  'PROTOCOL_TLS_CLIENT',
  'PROTOCOL_TLS_SERVER',
  'PROTOCOL_TLSv1',
  'PROTOCOL_TLSv1_1',
  'PROTOCOL_TLSv1_2',
  'PROTOCOL_SSLv23',
]);

const ProfileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  hosts: z.array(z.string().min(1)).min(1, 'At least one host is required'),
  port: z.number().int().min(1).max(65535),
  username: z.string(),
  password: z.string(),
  ssl_enabled: z.boolean(),
  ssl_protocol: SslProtocolSchema,
  ssl_cert_path: z.string(),
  default_keyspace: z.string(),
  consistency_level: ConsistencyLevelSchema,
  connection_timeout: z.number().int().min(1).max(300),
  protocol_version: z.number().int().min(1).max(5),
}) satisfies z.ZodType<ConnectionProfile>;

const ConnectBodySchema = z.object({
  name: z.string().min(1),
});

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function badRequest(message: string): Error {
  const err = new Error(message);
  (err as { status?: number }).status = 400;
  return err;
}

function parseProfile(body: unknown): ConnectionProfile {
  const result = ProfileSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const detail = first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'invalid profile';
    throw badRequest(`Invalid profile: ${detail}`);
  }
  return result.data;
}

function parseConnectBody(body: unknown): { name: string } {
  const result = ConnectBodySchema.safeParse(body);
  if (!result.success) {
    throw badRequest('Invalid request: name is required');
  }
  return result.data;
}

connectionRouter.get('/', (_req, res) => {
  res.json({ ok: true, data: listProfiles() });
});

connectionRouter.post('/', (req, res) => {
  const profile = parseProfile(req.body);
  const saved = upsertProfile(profile);
  res.json({ ok: true, data: saved });
});

connectionRouter.put('/:name', (req, res) => {
  const profile = parseProfile(req.body);
  const paramName = req.params.name;
  if (!paramName) throw badRequest('Profile name is required');
  if (paramName !== profile.name) {
    // Renames: remove the old, insert the new.
    deleteProfileFromStore(paramName);
  }
  const saved = upsertProfile(profile);
  res.json({ ok: true, data: saved });
});

connectionRouter.delete('/:name', (req, res) => {
  const name = req.params.name;
  if (!name) throw badRequest('Profile name is required');
  deleteProfileFromStore(name);
  res.json({ ok: true, data: { deleted: name } });
});

// IMPORTANT: /status, /connect, /disconnect must be declared before any
// catch-all `/:name` routes — they are, because we use distinct verbs.
connectionRouter.get('/status', (_req, res) => {
  res.json({ ok: true, data: status() });
});

connectionRouter.post(
  '/connect',
  asyncHandler(async (req, res) => {
    const { name } = parseConnectBody(req.body);
    const profile = getProfile(name);
    if (!profile) {
      throw badRequest(`Profile not found: ${name}`);
    }
    const result = await connect(profile);
    if (!result.ok) {
      res.status(502).json({ ok: false, message: result.message });
      return;
    }
    setLastConnection(name);
    res.json({ ok: true, data: result.status });
  }),
);

connectionRouter.post(
  '/disconnect',
  asyncHandler(async (_req, res) => {
    const next = await disconnect();
    res.json({ ok: true, data: next });
  }),
);
