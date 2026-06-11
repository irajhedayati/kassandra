/**
 * Typed wrapper for the raw CQL execution endpoint.
 *
 * The server returns a `QueryResponse` envelope (success | error). The
 * fetch wrapper only throws when the HTTP layer fails — application-level
 * CQL errors come back inside the envelope, so callers can render them
 * inline.
 */
import type { CqlExecRequest, QueryResponse } from '@py-sandra/shared';
import { apiSend } from './client.js';

export async function execCql(req: CqlExecRequest): Promise<QueryResponse> {
  return apiSend<QueryResponse>('POST', '/api/cql', req);
}
