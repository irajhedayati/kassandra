import type { CreateKeyspaceRequest, KeyspaceList, TableList, TableSchema } from '@kassandra/shared';
import { apiGet, apiSend } from './client.js';

/**
 * Schema introspection client.
 * Mirrors server routes mounted at /api/schema.
 */

export function listKeyspaces(): Promise<KeyspaceList> {
  return apiGet<KeyspaceList>('/api/schema/keyspaces');
}

export function listTables(keyspace: string): Promise<TableList> {
  return apiGet<TableList>(
    `/api/schema/keyspaces/${encodeURIComponent(keyspace)}/tables`,
  );
}

export function getSchema(keyspace: string, table: string): Promise<TableSchema> {
  return apiGet<TableSchema>(
    `/api/schema/keyspaces/${encodeURIComponent(keyspace)}/tables/${encodeURIComponent(table)}`,
  );
}

export function createKeyspace(req: CreateKeyspaceRequest): Promise<{ keyspace: string }> {
  return apiSend<{ keyspace: string }>('POST', '/api/schema/keyspaces', req);
}
