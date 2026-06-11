/**
 * Raw CQL execution.
 *
 * Routes (mounted at /api/cql):
 *
 *   POST / → body: CqlExecRequest → QueryResponse
 */
import { Router } from 'express';

export const cqlRouter = Router();

cqlRouter.post('/', (_req, res) => {
  res.status(501).json({ success: false, message: 'not implemented: cql exec' });
});
