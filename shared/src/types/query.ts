/**
 * Query result envelopes — used by both the data grid (paginated table reads)
 * and the raw CQL editor.
 *
 * Cassandra paging-state is server-side opaque bytes; we encode it as base64
 * over the wire so the React client can pass it back unchanged.
 */

export type CqlValue =
  | null
  | string
  | number
  | boolean
  | CqlValue[]
  | { [k: string]: CqlValue };

export type Row = Record<string, CqlValue>;

export interface QueryResult {
  success: true;
  rows: Row[];
  /** Base64-encoded paging state, or null if there's no next page. */
  pagingState: string | null;
  hasMorePages: boolean;
  /** Optional informational message (e.g. for non-SELECT statements). */
  message?: string;
}

export interface QueryError {
  success: false;
  message: string;
}

export type QueryResponse = QueryResult | QueryError;

export interface PaginatedReadRequest {
  pageSize: number;
  /** Base64-encoded paging state, or null/undefined to start from the first page. */
  pagingState?: string | null;
  /** Per-column equality filters; values are formatted client-side as strings. */
  filters?: Record<string, string>;
}

export interface CqlExecRequest {
  query: string;
  pageSize?: number;
  pagingState?: string | null;
}
