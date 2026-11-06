/**
 * Document layer: a small key -> JSON-document store. DocumentRepository
 * (documentRepository.ts) builds the ConfigRepository on top of it, so a
 * backend that fits this shape (files, Redis, a key-value service, ...) only
 * has to implement this interface. FileStorage (fileStorage.ts) is the default.
 * Backends with a richer model (SQLite) implement ConfigRepository directly.
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
export type { LockOptions } from './repository.js';
import type { LockOptions } from './repository.js';

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
