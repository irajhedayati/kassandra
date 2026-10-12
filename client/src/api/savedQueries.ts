import type { ImportSavedQueriesResult, SavedQuery, SavedQueryInput } from '@kassandra/shared';
import { apiGet, apiSend } from './client.js';

/** Typed wrappers for the /api/saved-queries routes. */

export function listSavedQueries(): Promise<SavedQuery[]> {
  return apiGet<SavedQuery[]>('/api/saved-queries');
}

export function createSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
  return apiSend<SavedQuery>('POST', '/api/saved-queries', input);
}

export function updateSavedQuery(id: string, input: SavedQueryInput): Promise<SavedQuery> {
  return apiSend<SavedQuery>('PUT', `/api/saved-queries/${encodeURIComponent(id)}`, input);
}

export function deleteSavedQuery(id: string): Promise<null> {
  return apiSend<null>('DELETE', `/api/saved-queries/${encodeURIComponent(id)}`);
}

export function importSavedQueries(queries: unknown[]): Promise<ImportSavedQueriesResult> {
  return apiSend<ImportSavedQueriesResult>('POST', '/api/saved-queries/import', { queries });
}
