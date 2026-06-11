/**
 * Row CRUD + paginated reads.
 *
 * Routes (mounted at /api/data):
 *
 *   POST   /:ks/:t/rows         → body: PaginatedReadRequest                  → QueryResponse
 *   POST   /:ks/:t/rows/insert  → body: { values: Row }                       → QueryResponse
 *   PUT    /:ks/:t/rows         → body: { keys, updates }                     → QueryResponse
 *   DELETE /:ks/:t/rows         → body: { keys }                              → QueryResponse
 *
 * All routes:
 *   - Call `requireSession()` first.
 *   - Validate the body with zod.
 *   - On success, return a QueryResponse envelope (`success: true|false`).
 *   - On unhandled error, return `{ success: false, message }` with the error's
 *     status (default 500). The shape matches QueryResponse, NOT ApiErr.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { QueryResponse, Row } from '@kassandra/shared';
import { requireSession } from '../cassandra/state.js';
import { getTableSchema } from '../cassandra/schema.js';
import { CassandraRepository } from '../cassandra/repository.js';

export const dataRouter = Router();

// ---------- zod schemas ----------

const cqlValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.array(cqlValueSchema),
    z.record(cqlValueSchema),
  ]),
);

const rowSchema = z.record(cqlValueSchema);

const readBodySchema = z.object({
  pageSize: z.number().int().positive().max(1000).default(25),
  pagingState: z.string().nullable().optional(),
  filters: z.record(z.string()).optional(),
});

const insertBodySchema = z.object({
  values: rowSchema,
});

const updateBodySchema = z.object({
  keys: rowSchema,
  updates: rowSchema,
});

const deleteBodySchema = z.object({
  keys: rowSchema,
});

// ---------- helpers ----------

function paramsKsT(req: Request): { keyspace: string; table: string } {
  const keyspace = String(req.params['keyspace'] ?? '');
  const table = String(req.params['table'] ?? '');
  if (!keyspace || !table) {
    const err = new Error('Missing keyspace or table in path.');
    (err as { status?: number }).status = 400;
    throw err;
  }
  return { keyspace, table };
}

/**
 * Run an async route handler, sending the resolved QueryResponse as JSON.
 * On error, send `{ success: false, message }` (NOT ApiErr) with the
 * appropriate status code, so the client sees a consistent envelope.
 */
function runQuery(
  handler: (req: Request) => Promise<QueryResponse>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      const result = await handler(req);
      const status = result.success ? 200 : 400;
      res.status(status).json(result);
    } catch (err) {
      const status =
        typeof (err as { status?: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status >= 500) console.error('[kassandra] data route error', err);
      const body: QueryResponse = { success: false, message };
      res.status(status).json(body);
    }
  };
}

// ---------- routes ----------

dataRouter.post(
  '/:keyspace/:table/rows',
  runQuery(async (req) => {
    const { keyspace, table } = paramsKsT(req);
    const body = readBodySchema.parse(req.body ?? {});
    const ctx = requireSession();
    const schema = await getTableSchema(ctx.client, keyspace, table);
    const repo = new CassandraRepository(ctx.client);
    return repo.readRows(schema, {
      pageSize: body.pageSize,
      pagingState: body.pagingState ?? null,
      filters: body.filters ?? {},
    });
  }),
);

dataRouter.post(
  '/:keyspace/:table/rows/insert',
  runQuery(async (req) => {
    const { keyspace, table } = paramsKsT(req);
    const body = insertBodySchema.parse(req.body ?? {});
    const ctx = requireSession();
    const schema = await getTableSchema(ctx.client, keyspace, table);
    const repo = new CassandraRepository(ctx.client);
    const out = await repo.insertRow(schema, body.values as Row);
    return {
      success: true,
      rows: [],
      pagingState: null,
      hasMorePages: false,
      message: out.message ?? 'Row inserted.',
    };
  }),
);

dataRouter.put(
  '/:keyspace/:table/rows',
  runQuery(async (req) => {
    const { keyspace, table } = paramsKsT(req);
    const body = updateBodySchema.parse(req.body ?? {});
    const ctx = requireSession();
    const schema = await getTableSchema(ctx.client, keyspace, table);
    const repo = new CassandraRepository(ctx.client);
    const out = await repo.updateRow(
      schema,
      body.keys as Row,
      body.updates as Row,
    );
    return {
      success: true,
      rows: [],
      pagingState: null,
      hasMorePages: false,
      message: out.message ?? 'Row updated.',
    };
  }),
);

dataRouter.delete(
  '/:keyspace/:table/rows',
  runQuery(async (req) => {
    const { keyspace, table } = paramsKsT(req);
    const body = deleteBodySchema.parse(req.body ?? {});
    const ctx = requireSession();
    const schema = await getTableSchema(ctx.client, keyspace, table);
    const repo = new CassandraRepository(ctx.client);
    const out = await repo.deleteRow(schema, body.keys as Row);
    return {
      success: true,
      rows: [],
      pagingState: null,
      hasMorePages: false,
      message: out.message ?? 'Row deleted.',
    };
  }),
);
