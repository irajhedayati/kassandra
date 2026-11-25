/**
 * Query history: every CQL run from the editor, kept per connection profile so
 * it can be searched and re-run later. Persisted by the config backend, capped
 * per profile (KASSANDRA_HISTORY_LIMIT, default 200; the oldest entries go first).
 */

/** How a run ended: all statements succeeded, the first failed, or some succeeded before one failed. */
export type QueryHistoryOutcome = 'success' | 'failed' | 'partial';

/** A `:name` parameter of the query, with its declared CQL type and the value it ran with. */
export interface QueryHistoryParam {
  name: string;
  type: string;
  value: string;
}

export interface QueryHistoryEntry {
  id: string;
  /** Name of the connection profile the query ran against. */
  profile: string;
  query: string;
  /** In the order they appear in the query. */
  params: QueryHistoryParam[];
  /** When the run started, ISO 8601 in UTC with milliseconds (`Date#toISOString()`). */
  started_at: string;
  duration_ms: number;
  /** How many statements the run executed (a script can hold several). */
  statements: number;
  outcome: QueryHistoryOutcome;
  /** The error of the failing statement; null when the run succeeded. */
  error: string | null;
}

/** An entry to record; the repository assigns the id. */
export type QueryHistoryInput = Omit<QueryHistoryEntry, 'id'>;

export interface QueryHistoryListOptions {
  /** Case-insensitive substring of the query text. */
  search?: string;
  /** `next_cursor` of the previous page; omit for the first page. */
  cursor?: string | null;
  /** Page size; default 50, at most 500. */
  limit?: number;
}

/** One page of a profile's history, newest first. */
export interface QueryHistoryPage {
  entries: QueryHistoryEntry[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  next_cursor: string | null;
}
