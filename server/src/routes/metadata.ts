/**
 * Per-column metadata (display_type, hide, map_schema).
 *
 * Persisted per connection + table by the active config repository (see config/repository.ts).
 *
 * Routes (mounted at /api/metadata):
 *
 *   GET /files                  → ApiOk<TableMetadataFile[]>  (tables that have metadata, named <connection>-<keyspace>.<table>.json)
 *   GET /:ks/:t                 → ApiOk<Record<string, ColumnMetadata>>
 *   PUT /:ks/:t/:column         → body: ColumnMetadata → ApiOk<ColumnMetadata>
 *   POST /:ks/:t/import         → body: ImportTableMetadataRequest → ApiOk<Record<string, ColumnMetadata>>
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type {
  ApiOk,
  ColumnMetadata,
  ImportTableMetadataRequest,
  TableMetadataFile,
} from '@kassandra/shared';
import { getTableSchema } from '../cassandra/schema.js';
import { requireSession } from '../cassandra/state.js';
import { importTableMetadata } from '../config/importSchema.js';
import { getTableMetadata, listTableFiles, setColumnMetadata, withRepository } from '../config/store.js';
import { columnMetadataSchema, TableFileError } from '../config/tables.js';

export const metadataRouter = Router();

metadataRouter.get('/files', async (_req, res) => {
  const body: ApiOk<TableMetadataFile[]> = { ok: true, data: await listTableFiles() };
  res.json(body);
});

metadataRouter.get('/:keyspace/:table', async (req, res) => {
  const { profile } = requireSession();
  const { keyspace, table } = req.params as { keyspace: string; table: string };
  const data = await getTableMetadata(profile.name, keyspace, table);
  const body: ApiOk<Record<string, ColumnMetadata>> = { ok: true, data };
  res.json(body);
});

metadataRouter.put('/:keyspace/:table/:column', async (req, res) => {
  const { profile } = requireSession();
  const { keyspace, table, column } = req.params as {
    keyspace: string;
    table: string;
    column: string;
  };
  const parsed = columnMetadataSchema.parse(req.body);
  const saved = await setColumnMetadata(profile.name, keyspace, table, column, parsed);
  const body: ApiOk<ColumnMetadata> = { ok: true, data: saved };
  res.json(body);
});

const importRequestSchema = z.object({ file: z.string().min(1), overwrite: z.boolean().optional() });

metadataRouter.post(
  '/:keyspace/:table/import',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client, profile } = requireSession();
      const { keyspace, table } = req.params as { keyspace: string; table: string };
      const request = importRequestSchema.safeParse(req.body);
      if (!request.success) throw new TableFileError('Body must be { file: string, overwrite?: boolean }', 400);
      const { file, overwrite }: ImportTableMetadataRequest = request.data;
      const schema = await getTableSchema(client, keyspace, table);
      const columns = schema.columns.map((c) => c.name);
      const data = await withRepository((repository) =>
        importTableMetadata(repository, file, { connection: profile.name, keyspace, table, columns }, overwrite === true),
      );
      const body: ApiOk<Record<string, ColumnMetadata>> = { ok: true, data };
      res.json(body);
    } catch (err) {
      next(err);
    }
  },
);
