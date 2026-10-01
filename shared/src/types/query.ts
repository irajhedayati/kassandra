/**
 * Query result envelopes; used by both the data grid (paginated table reads)
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

/**
 * - 'eq': column = value
 * - 'contains': list/set/map CONTAINS value (map: matches a value, not a key)
 * - 'contains_key': map CONTAINS KEY value
 * - 'map_entry_eq': map[mapKey] = value (requires `mapKey`)
 */
export type FilterOperator = 'eq' | 'contains' | 'contains_key' | 'map_entry_eq';

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  /** Required when operator is 'map_entry_eq'; the key to index into the map. */
  mapKey?: string;
  /** Formatted client-side as a string; coerced server-side to the column's CQL type. */
  value: string;
}

export interface PaginatedReadRequest {
  pageSize: number;
  /** Base64-encoded paging state, or null/undefined to start from the first page. */
  pagingState?: string | null;
  filters?: FilterCondition[];
}

export interface CqlExecRequest {
  query: string;
  pageSize?: number;
  pagingState?: string | null;
}
