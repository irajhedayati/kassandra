import type { ColumnMetadata } from '@kassandra/shared';
import { apiGet, apiSend } from './client.js';

/**
 * Typed wrappers for the /api/metadata routes.
 */

export function getMetadata(
  keyspace: string,
  table: string,
): Promise<Record<string, ColumnMetadata>> {
  return apiGet<Record<string, ColumnMetadata>>(
    `/api/metadata/${encodeURIComponent(keyspace)}/${encodeURIComponent(table)}`,
  );
}

export function setColumnMetadata(
  keyspace: string,
  table: string,
  column: string,
  metadata: ColumnMetadata,
): Promise<ColumnMetadata> {
  return apiSend<ColumnMetadata>(
    'PUT',
    `/api/metadata/${encodeURIComponent(keyspace)}/${encodeURIComponent(table)}/${encodeURIComponent(column)}`,
    metadata,
  );
}
