/**
 * Typed wrappers for the /api/data routes.
 * All four routes return a QueryResponse envelope; we propagate the
 * error message verbatim when `success === false`.
 */
import type {
  PaginatedReadRequest,
  QueryResponse,
  Row,
} from '@kassandra/shared';
import { ApiError, apiSend } from './client.js';

function unwrap(response: QueryResponse): QueryResponse {
  if (!response.success) {
    throw new ApiError(response.message, 400);
  }
  return response;
}

export async function readRows(
  keyspace: string,
  table: string,
  request: PaginatedReadRequest,
): Promise<QueryResponse> {
  const res = await apiSend<QueryResponse>(
    'POST',
    `/api/data/${encodeURIComponent(keyspace)}/${encodeURIComponent(table)}/rows`,
    request,
  );
  return unwrap(res);
}

export async function insertRow(
  keyspace: string,
  table: string,
  values: Row,
): Promise<QueryResponse> {
  const res = await apiSend<QueryResponse>(
    'POST',
    `/api/data/${encodeURIComponent(keyspace)}/${encodeURIComponent(table)}/rows/insert`,
    { values },
  );
  return unwrap(res);
}

export async function updateRow(
  keyspace: string,
  table: string,
  keys: Row,
  updates: Row,
): Promise<QueryResponse> {
  const res = await apiSend<QueryResponse>(
    'PUT',
    `/api/data/${encodeURIComponent(keyspace)}/${encodeURIComponent(table)}/rows`,
    { keys, updates },
  );
  return unwrap(res);
}

export async function deleteRow(
  keyspace: string,
  table: string,
  keys: Row,
): Promise<QueryResponse> {
  const res = await apiSend<QueryResponse>(
    'DELETE',
    `/api/data/${encodeURIComponent(keyspace)}/${encodeURIComponent(table)}/rows`,
    { keys },
  );
  return unwrap(res);
}
