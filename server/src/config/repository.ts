/**
 * What Kassandra persists, as the operations the application needs: connection
 * profiles, the last connection, favorite keyspaces, saved queries and
 * per-table column metadata, plus the version of the data and a cross-process
 * lock. A backend implements this interface; how it lays the data out is its
 * own business:
 *
 *   DocumentRepository  JSON documents on top of any ConfigStorage (files by default)
 *   SqliteRepository    a relational schema managed with Drizzle migrations
 *
 * Operations are individually atomic but not serialized against each other;
 * store.ts funnels every call through one queue so read-modify-write backends
 * (documents) are safe. Methods are async so remote backends are possible.
 */
import type {
  AppSettings,
  ColumnMetadata,
  ConnectionProfile,
  SavedQuery,
  SavedQueryInput,
} from '@kassandra/shared';
import { DEFAULT_PROFILE } from '@kassandra/shared';

export interface TableRef {
  connection: string;
  keyspace: string;
  table: string;
}

export type TableColumns = Record<string, ColumnMetadata>;

/** A table that has metadata, and for how many columns. */
export interface TableSummary extends TableRef {
  columns: number;
}

/** Everything a backend holds, in a backend-neutral shape; used to copy between backends. */
export interface ConfigSnapshot {
  /** Kassandra version that last wrote the data, null if never recorded. */
  version: string | null;
  settings: AppSettings;
  tables: (TableRef & { columns: TableColumns })[];
}

export interface LockOptions {
  /** How long to wait for another process to release the lock. Default 60 s. */
  timeoutMs?: number;
  /** A lock older than this is assumed to belong to a crashed process. Default 5 min. */
  staleMs?: number;
}

export class SavedQueryError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export interface ConfigRepository {
  /** Where the data lives, for log and error messages. */
  readonly description: string;

  // --- lifecycle ---------------------------------------------------------------------------

  /**
   * Bring the data up to the running version: create or upgrade the schema or
   * documents, and record the version. Returns the versions applied. Call once
   * at startup, and on a new backend before using it.
   */
  migrate(): Promise<string[]>;
  /** Version of Kassandra that last wrote the data, or null if never recorded. */
  getVersion(): Promise<string | null>;
  /** True when nothing (no profile, query, favorite or metadata) is stored. */
  isEmpty(): Promise<boolean>;
  exportSnapshot(): Promise<ConfigSnapshot>;
  /** Add everything in `snapshot` to this (empty, migrated) backend. Entries for unknown connections are skipped. */
  importSnapshot(snapshot: ConfigSnapshot): Promise<void>;
  /**
   * Exclusive lock across processes sharing this backend. Waits for the holder,
   * takes over a stale lock, rejects after the timeout. Resolves to the release function.
   */
  lock(options?: LockOptions): Promise<() => Promise<void>>;
  /** Release resources (file handles). The repository must not be used afterwards. */
  close(): void;

  // --- connection profiles -----------------------------------------------------------------

  /** In the order they were created. */
  listProfiles(): Promise<ConnectionProfile[]>;
  getProfile(name: string): Promise<ConnectionProfile | null>;
  /** Insert, or replace the profile with the same name (keeping its place in the list). */
  upsertProfile(profile: ConnectionProfile): Promise<ConnectionProfile>;
  /** Also removes the profile's favorites and table metadata, and clears it as the last connection. */
  deleteProfile(name: string): Promise<void>;
  /** Name of the last connection, '' if none. */
  getLastConnection(): Promise<string>;
  setLastConnection(name: string): Promise<void>;

  // --- favorite keyspaces ------------------------------------------------------------------

  getFavoriteKeyspaces(profile: string): Promise<string[]>;
  /** Idempotent. Returns the profile's favorites afterwards. */
  addFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]>;
  removeFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]>;

  // --- saved queries -----------------------------------------------------------------------

  listSavedQueries(): Promise<SavedQuery[]>;
  /** Rejects with SavedQueryError 409 if the name is taken. */
  createSavedQuery(input: SavedQueryInput): Promise<SavedQuery>;
  /** Rejects with SavedQueryError 404 (unknown id) or 409 (name taken by another query). */
  updateSavedQuery(id: string, input: SavedQueryInput): Promise<SavedQuery>;
  /** Rejects with SavedQueryError 404 if there is no such query. */
  deleteSavedQuery(id: string): Promise<void>;
  /** Upsert by name: a query with the same name is overwritten (keeping its id). */
  importSavedQueries(inputs: SavedQueryInput[]): Promise<{ created: number; updated: number }>;

  // --- table metadata ----------------------------------------------------------------------

  /** Column name -> metadata; empty if the table has none. */
  getTableMetadata(ref: TableRef): Promise<TableColumns>;
  /** Merge `metadata` into the column's existing metadata. Returns the merged result. */
  setColumnMetadata(ref: TableRef, column: string, metadata: ColumnMetadata): Promise<ColumnMetadata>;
  /** Replace all of the table's metadata. */
  replaceTableMetadata(ref: TableRef, columns: TableColumns): Promise<void>;
  /** Every table that has metadata. */
  listTables(): Promise<TableSummary[]>;
}

/** Coerce a partial profile (hand-edited file, older version) into a full one by filling in defaults. */
export function normalizeProfile(p: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    ...DEFAULT_PROFILE,
    ...p,
    name: p.name ?? '',
    hosts: Array.isArray(p.hosts) && p.hosts.length > 0 ? p.hosts : ['127.0.0.1'],
  };
}
