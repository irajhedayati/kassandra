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

export const metadataRouter = Router();

metadataRouter.get('/:keyspace/:table', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: get metadata' });
});

metadataRouter.put('/:keyspace/:table/:column', (_req, res) => {
  res.status(501).json({ ok: false, message: 'not implemented: set metadata' });
});
