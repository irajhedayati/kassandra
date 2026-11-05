/**
 * ConfigStorage backed by one SQLite database file (node:sqlite, no native
 * dependency).
 *
 *   documents(key, value)   one row per key, `value` is the JSON text
 *   meta(name, value)       the Kassandra version of the data
 *   lock(id, owner, taken_at)  at most one row: the holder of the storage lock
 *
 * The database's own layout is versioned with `PRAGMA user_version` and
 * brought up to date when the file is opened (SCHEMA_STEPS below); what the
 * documents contain is versioned and migrated by the regular config migrations.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { keySegments } from './keys.js';
import type { ConfigStorage, LockOptions } from './storage.js';

const VERSION_ROW = 'version';

/** Statements that take the database from schema version N to N + 1. Append only. */
const SCHEMA_STEPS: string[][] = [
  [
    'CREATE TABLE documents (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
    'CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
    'CREATE TABLE lock (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, taken_at INTEGER NOT NULL)',
  ],
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SqliteStorage implements ConfigStorage {
  private readonly db: DatabaseSync;

  constructor(readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.upgradeSchema();
  }

  get description(): string {
    return `SQLite database ${this.file}`;
  }

  private upgradeSchema(): void {
    // IMMEDIATE so two processes opening a new file do not both create the tables.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (current > SCHEMA_STEPS.length) {
        throw new Error(
          `${this.file} has database schema ${current}, newer than this version of Kassandra understands (${SCHEMA_STEPS.length})`,
        );
      }
      for (let v = current; v < SCHEMA_STEPS.length; v++) {
        for (const statement of SCHEMA_STEPS[v]!) this.db.exec(statement);
      }
      if (current < SCHEMA_STEPS.length) this.db.exec(`PRAGMA user_version = ${SCHEMA_STEPS.length}`);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      this.db.close();
      throw err;
    }
  }

  /** Release the file handle. */
  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  async get(key: string): Promise<unknown | undefined> {
    keySegments(key);
    const row = this.db.prepare('SELECT value FROM documents WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row === undefined ? undefined : JSON.parse(row.value);
  }

  async put(key: string, value: unknown): Promise<void> {
    keySegments(key);
    this.db
      .prepare('INSERT INTO documents (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    keySegments(key);
    this.db.prepare('DELETE FROM documents WHERE key = ?').run(key);
  }

  async list(prefix: string): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT key FROM documents WHERE substr(key, 1, length(?1)) = ?1 ORDER BY key')
      .all(prefix) as { key: string }[];
    return rows.map((r) => r.key);
  }

  async getVersion(): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM meta WHERE name = ?').get(VERSION_ROW) as
      | { value: string }
      | undefined;
    return row?.value || null;
  }

  async setVersion(version: string): Promise<void> {
    this.db
      .prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
      .run(VERSION_ROW, version);
  }

  async lock({ timeoutMs = 60_000, staleMs = 300_000 }: LockOptions = {}): Promise<() => Promise<void>> {
    const owner = randomUUID();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const now = Date.now();
      // One statement, so taking over a stale lock and claiming it cannot interleave with another process.
      const claimed = this.db
        .prepare(
          `INSERT INTO lock (id, owner, taken_at) VALUES (1, ?1, ?2)
           ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, taken_at = excluded.taken_at
           WHERE lock.taken_at < ?3`,
        )
        .run(owner, now, now - staleMs);
      if (claimed.changes > 0) {
        return async () => {
          this.db.prepare('DELETE FROM lock WHERE id = 1 AND owner = ?').run(owner);
        };
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for another process to release the lock in ${this.file}`);
      }
      await sleep(100);
    }
  }
}

let shared: SqliteStorage | null = null;

/** The process-wide connection to `file`; switching to another file closes the previous one. */
export function sharedSqliteStorage(file: string): SqliteStorage {
  if (shared?.file !== file) {
    shared?.close();
    shared = new SqliteStorage(file);
  }
  return shared;
}

/** Close the shared connection (it is reopened on demand). */
export function closeSharedSqliteStorage(): void {
  shared?.close();
  shared = null;
}
