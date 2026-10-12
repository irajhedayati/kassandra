/**
 * Saved parametrized queries, persisted in config.json.
 *
 * Routes (mounted at /api/saved-queries):
 *
 *   GET    /          → ApiOk<SavedQuery[]>
 *   POST   /          → body: SavedQueryInput → ApiOk<SavedQuery>
 *   PUT    /:id       → body: SavedQueryInput → ApiOk<SavedQuery>
 *   DELETE /:id       → ApiOk<null>
 *   POST   /import    → body: { queries: unknown[] } → ApiOk<ImportSavedQueriesResult>
 *
 * Export is the GET list; the client serializes it to a file. Execution goes
 * through POST /api/cql (the editor sends the parameter values).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ApiOk, ImportSavedQueriesResult, SavedQuery } from '@kassandra/shared';
import {
  createSavedQuery,
  deleteSavedQuery,
  importSavedQueries,
  listSavedQueries,
  updateSavedQuery,
} from '../config/store.js';

export const savedQueriesRouter = Router();

const inputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().default(''),
  query: z.string().trim().min(1, 'Query is required'),
  paramTypes: z.record(z.string(), z.string()).default({}),
});

savedQueriesRouter.get('/', (_req, res) => {
  const body: ApiOk<SavedQuery[]> = { ok: true, data: listSavedQueries() };
  res.json(body);
});

savedQueriesRouter.post('/', (req, res) => {
  const saved = createSavedQuery(inputSchema.parse(req.body));
  const body: ApiOk<SavedQuery> = { ok: true, data: saved };
  res.json(body);
});

savedQueriesRouter.post('/import', (req, res) => {
  const { queries } = z.object({ queries: z.array(z.unknown()) }).parse(req.body);
  const valid: z.infer<typeof inputSchema>[] = [];
  const skipped: ImportSavedQueriesResult['skipped'] = [];
  for (const candidate of queries) {
    const parsed = inputSchema.safeParse(candidate);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      const name =
        candidate && typeof candidate === 'object' && typeof (candidate as { name?: unknown }).name === 'string'
          ? (candidate as { name: string }).name
          : '(unnamed)';
      skipped.push({ name, message: parsed.error.issues.map((i) => i.message).join('; ') });
    }
  }
  const { created, updated } = importSavedQueries(valid);
  const body: ApiOk<ImportSavedQueriesResult> = { ok: true, data: { created, updated, skipped } };
  res.json(body);
});

savedQueriesRouter.put('/:id', (req, res) => {
  const saved = updateSavedQuery(req.params.id as string, inputSchema.parse(req.body));
  const body: ApiOk<SavedQuery> = { ok: true, data: saved };
  res.json(body);
});

savedQueriesRouter.delete('/:id', (req, res) => {
  deleteSavedQuery(req.params.id as string);
  const body: ApiOk<null> = { ok: true, data: null };
  res.json(body);
});
