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
 *
 * Owns: src/cassandra/connection.ts, src/config/store.ts.
 */
import { Router } from 'express';

export const connectionRouter = Router();

connectionRouter.get('/', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: list profiles' });
});

connectionRouter.post('/', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: create profile' });
});

connectionRouter.put('/:name', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: update profile' });
});

connectionRouter.delete('/:name', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: delete profile' });
});

connectionRouter.post('/connect', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: connect' });
});

connectionRouter.post('/disconnect', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: disconnect' });
});

connectionRouter.get('/status', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: status' });
});
