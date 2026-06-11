/**
 * Per-column metadata (display_type, hide, map_schema).
 *
 * Persisted to ~/.py-sandra/config.json under settings.table_metadata.
 *
 * Routes (mounted at /api/metadata):
 *
 *   GET /:ks/:t                 → ApiOk<Record<string, ColumnMetadata>>
 *   PUT /:ks/:t/:column         → body: ColumnMetadata → ApiOk<ColumnMetadata>
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ApiOk, ColumnMetadata } from '@py-sandra/shared';
import { requireSession } from '../cassandra/state.js';
import { getTableMetadata, setColumnMetadata } from '../config/store.js';

export const metadataRouter = Router();

const mapSchemaEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
});

const columnMetadataSchema = z
  .object({
    hide: z.boolean().optional(),
    display_type: z.string().optional(),
    map_schema: z.array(mapSchemaEntrySchema).optional(),
  })
  .strict();

metadataRouter.get('/:keyspace/:table', (req, res) => {
  requireSession();
  const { keyspace, table } = req.params as { keyspace: string; table: string };
  const data = getTableMetadata(keyspace, table);
  const body: ApiOk<Record<string, ColumnMetadata>> = { ok: true, data };
  res.json(body);
});

metadataRouter.put('/:keyspace/:table/:column', (req, res) => {
  requireSession();
  const { keyspace, table, column } = req.params as {
    keyspace: string;
    table: string;
    column: string;
  };
  const parsed = columnMetadataSchema.parse(req.body);
  const saved = setColumnMetadata(keyspace, table, column, parsed);
  const body: ApiOk<ColumnMetadata> = { ok: true, data: saved };
  res.json(body);
});
