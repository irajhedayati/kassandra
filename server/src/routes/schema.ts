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
import { Router } from 'express';

export const schemaRouter = Router();

schemaRouter.get('/keyspaces', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: list keyspaces' });
});

schemaRouter.get('/keyspaces/:keyspace/tables', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: list tables' });
});

schemaRouter.get('/keyspaces/:keyspace/tables/:table', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: table schema' });
});
