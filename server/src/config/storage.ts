/**
 * Storage abstraction for everything Kassandra persists: a small key ->
 * JSON-document store. The settings logic (store.ts), the table metadata
 * (tables.ts) and the migrations are written against this interface only, so a
 * different backend (SQLite, an RDBMS, Redis, Firebase, ...) only has to
 * implement it. FileStorage (fileStorage.ts) is the default.
 *
 * Keys:
 *   config                      connection profiles, favorites, saved queries
 *   tables/<conn>-<ks>.<table>  per-table column metadata (see tables.ts)
 *   backups/<version>/<key>     copies made before a migration
 *
 * Keys are `/`-separated segments of [A-Za-z0-9_%.-]; implementations may
 * reject anything else. The version of the data is kept apart from the keys
 * because it is read before anything can be parsed.
 */
import { FileStorage, getConfigDir } from './fileStorage.js';

export interface LockOptions {
  /** How long to wait for another process to release the lock. Default 60 s. */
  timeoutMs?: number;
  /** A lock older than this is assumed to belong to a crashed process. Default 5 min. */
  staleMs?: number;
}

export interface ConfigStorage {
  /** Where the data lives, for log and error messages. */
  readonly description: string;

  /** The document under `key`, or undefined if there is none. Rejects if it cannot be read or parsed. */
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  /** No-op if the key does not exist. */
  delete(key: string): Promise<void>;
  /** All keys starting with `prefix` (use '' for everything), sorted. */
  list(prefix: string): Promise<string[]>;

  /** Version of Kassandra that last wrote the data, or null if never recorded. */
  getVersion(): Promise<string | null>;
  setVersion(version: string): Promise<void>;

  /**
   * Exclusive lock across processes sharing this storage. Waits for the holder,
   * takes over a stale lock, rejects after the timeout. Resolves to the release function.
   */
  lock(options?: LockOptions): Promise<() => Promise<void>>;
}

let override: ConfigStorage | null = null;

/** The active storage. Defaults to files in `KASSANDRA_HOME ?? ~/.kassandra`. */
export function getStorage(): ConfigStorage {
  return override ?? new FileStorage(getConfigDir());
}

/** Use `storage` instead of the default; pass null to go back to it. */
export function setStorage(storage: ConfigStorage | null): void {
  override = storage;
}
