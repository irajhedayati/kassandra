/**
 * Row CRUD + paginated reads.
 *
 * Routes (mounted at /api/data):
 *
 *   POST   /:ks/:t/rows         → body: PaginatedReadRequest                  → QueryResponse
 *   POST   /:ks/:t/rows/insert  → body: { values: Record<string, unknown> }   → QueryResponse
 *   PUT    /:ks/:t/rows         → body: { keys, updates }                     → QueryResponse
 *   DELETE /:ks/:t/rows         → body: { keys }                              → QueryResponse
 *
 * Reads use POST so the paging-state and filters travel in the body
 * (they are too large/structured for query strings).
 *
 * Owns: src/cassandra/repository.ts.
 */
import { Router } from 'express';

export const dataRouter = Router();

dataRouter.post('/:keyspace/:table/rows', (_req, res) => {
  res.status(501).json({ success: false, message: 'not implemented: read rows' });
});

dataRouter.post('/:keyspace/:table/rows/insert', (_req, res) => {
  res.status(501).json({ success: false, message: 'not implemented: insert' });
});

dataRouter.put('/:keyspace/:table/rows', (_req, res) => {
  res.status(501).json({ success: false, message: 'not implemented: update' });
});

dataRouter.delete('/:keyspace/:table/rows', (_req, res) => {
  res.status(501).json({ success: false, message: 'not implemented: delete' });
});
