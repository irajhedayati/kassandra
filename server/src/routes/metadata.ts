/**
 * Per-column metadata (display_type, hide, map_schema).
 *
 * Persisted per connection + table in ~/.kassandra/tables/ (see config/tables.ts).
 *
 * Routes (mounted at /api/metadata):
 *
 *   GET /:ks/:t                 → ApiOk<Record<string, ColumnMetadata>>
 *   PUT /:ks/:t/:column         → body: ColumnMetadata → ApiOk<ColumnMetadata>
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ApiOk, ColumnMetadata } from '@kassandra/shared';
import { requireSession } from '../cassandra/state.js';
import { getTableMetadata, setColumnMetadata } from '../config/store.js';

export const metadataRouter = Router();

const mapSchemaEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  display_type: z.string().optional(),
  enum_values: z.array(z.string()).optional(),
});

const columnMetadataSchema = z
  .object({
    hide: z.boolean().optional(),
    display_type: z.string().optional(),
    map_schema: z.array(mapSchemaEntrySchema).optional(),
    enum_values: z.array(z.string()).optional(),
  })
  .strict();

metadataRouter.get('/:keyspace/:table', (req, res) => {
  const { profile } = requireSession();
  const { keyspace, table } = req.params as { keyspace: string; table: string };
  const data = getTableMetadata(profile.name, keyspace, table);
  const body: ApiOk<Record<string, ColumnMetadata>> = { ok: true, data };
  res.json(body);
});

metadataRouter.put('/:keyspace/:table/:column', (req, res) => {
  const { profile } = requireSession();
  const { keyspace, table, column } = req.params as {
    keyspace: string;
    table: string;
    column: string;
  };
  const parsed = columnMetadataSchema.parse(req.body);
  const saved = setColumnMetadata(profile.name, keyspace, table, column, parsed);
  const body: ApiOk<ColumnMetadata> = { ok: true, data: saved };
  res.json(body);
});
