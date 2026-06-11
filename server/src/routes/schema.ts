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
} from '@py-sandra/shared';
import { requireSession } from '../cassandra/state.js';
import {
  getKeyspaces,
  getTables,
  getTableSchema,
} from '../cassandra/schema.js';

export const schemaRouter = Router();

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
      const keyspace = req.params['keyspace'];
      if (!keyspace) {
        const err = new Error('Missing keyspace parameter');
        (err as { status?: number }).status = 400;
        throw err;
      }
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
      const keyspace = req.params['keyspace'];
      const table = req.params['table'];
      if (!keyspace || !table) {
        const err = new Error('Missing keyspace or table parameter');
        (err as { status?: number }).status = 400;
        throw err;
      }
      const schema = await getTableSchema(ctx.client, keyspace, table);
      res.json({ ok: true, data: schema });
    } catch (err) {
      next(err);
    }
  },
);
