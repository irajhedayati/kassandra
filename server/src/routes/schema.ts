/**
 * Schema introspection over Cassandra system_schema tables.
 *
 * Routes (mounted at /api/schema):
 *
 *   GET /keyspaces                          → ApiOk<KeyspaceList>
 *   GET /keyspaces/:ks/tables               → ApiOk<TableList>
 *   GET /keyspaces/:ks/tables/:t            → ApiOk<TableSchema>
 *
 * Owns: src/cassandra/schema.ts.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  ApiOk,
  KeyspaceList,
  TableList,
  TableSchema,
} from '@kassandra/shared';
import { requireSession } from '../cassandra/state.js';
import {
  getKeyspaces,
  getTables,
  getTableSchema,
} from '../cassandra/schema.js';

export const schemaRouter = Router();

// Express 5 types route params as `string | string[] | undefined` (repeated
// path segments produce arrays). None of these routes use repeated segments,
// so an array value would indicate malformed input; treat it like "missing".
function requireStringParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') {
    const err = new Error(`Missing ${name} parameter`);
    (err as { status?: number }).status = 400;
    throw err;
  }
  return value;
}

schemaRouter.get(
  '/keyspaces',
  async (_req: Request, res: Response<ApiOk<KeyspaceList>>, next: NextFunction) => {
    try {
      const ctx = requireSession();
      const keyspaces = await getKeyspaces(ctx.client);
      res.json({ ok: true, data: { keyspaces } });
    } catch (err) {
      next(err);
    }
  },
);

schemaRouter.get(
  '/keyspaces/:keyspace/tables',
  async (req: Request, res: Response<ApiOk<TableList>>, next: NextFunction) => {
    try {
      const ctx = requireSession();
      const keyspace = requireStringParam(req, 'keyspace');
      const tables = await getTables(ctx.client, keyspace);
      res.json({ ok: true, data: { tables } });
    } catch (err) {
      next(err);
    }
  },
);

schemaRouter.get(
  '/keyspaces/:keyspace/tables/:table',
  async (req: Request, res: Response<ApiOk<TableSchema>>, next: NextFunction) => {
    try {
      const ctx = requireSession();
      const keyspace = requireStringParam(req, 'keyspace');
      const table = requireStringParam(req, 'table');
      const schema = await getTableSchema(ctx.client, keyspace, table);
      res.json({ ok: true, data: schema });
    } catch (err) {
      next(err);
    }
  },
);
