/**
 * Which storage backend holds the configuration, and where a SQLite database lives.
 *
 * Resolution order for the backend:
 *   1. KASSANDRA_STORAGE (then the choice is fixed; Docker/Helm set it)
 *   2. the choice saved by the Configuration page in ~/.kassandra/.backend
 *   3. `file`
 *
 * Like the location pointer (location.ts) this cannot live in the storage it
 * selects, so it is a dotfile in the default directory. KASSANDRA_SQLITE_PATH
 * fixes the SQLite database path the same way. A PostgreSQL or MySQL connection
 * is KASSANDRA_DB_URL (with KASSANDRA_DB_SCHEMA for the PostgreSQL schema), else
 * the one saved here; since it carries a password, the pointer file is readable
 * by its owner only.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SqlDialect } from '@kassandra/shared';
import { defaultConfigDir, getConfigDir } from './location.js';
import { parseConnectionUrl, validateConnection, type SqlConnection } from './sql/connection.js';

export const DEFAULT_BACKEND = 'file';
const POINTER_FILE_NAME = '.backend';
const SQLITE_FILE_NAME = 'kassandra.db';

export interface BackendChoice {
  backend: string;
  /** Database file, for the `sqlite` backend. */
  sqlitePath?: string;
  /** Database connection, for the `postgres` and `mysql` backends. Contains the password. */
  sql?: SqlConnection;
}

const envValue = (name: string): string | null => process.env[name]?.trim() || null;

function pointerFile(): string {
  return path.join(defaultConfigDir(), POINTER_FILE_NAME);
}

/** A saved connection if it is well formed, else undefined (a hand-edited pointer must not crash startup). */
function readSqlConnection(value: unknown): SqlConnection | undefined {
  const c = value as Partial<SqlConnection> | null;
  if (!c || typeof c !== 'object' || (c.dialect !== 'postgres' && c.dialect !== 'mysql')) return undefined;
  try {
    return validateConnection({
      dialect: c.dialect,
      host: String(c.host ?? ''),
      port: Number(c.port),
      database: String(c.database ?? ''),
      username: String(c.username ?? ''),
      password: String(c.password ?? ''),
      ssl: c.ssl === true,
      schema: String(c.schema ?? 'public'),
    });
  } catch {
    return undefined;
  }
}

function readPointer(): BackendChoice | null {
  try {
    const parsed = JSON.parse(readFileSync(pointerFile(), 'utf-8')) as Partial<BackendChoice>;
    return typeof parsed.backend === 'string' && parsed.backend !== ''
      ? {
          backend: parsed.backend,
          sqlitePath: typeof parsed.sqlitePath === 'string' ? parsed.sqlitePath : undefined,
          sql: readSqlConnection(parsed.sql),
        }
      : null;
  } catch {
    return null;
  }
}

/** True when KASSANDRA_STORAGE fixes the backend, so it cannot be changed from the UI. */
export function isBackendLocked(): boolean {
  return envValue('KASSANDRA_STORAGE') !== null;
}

/** Whether a backend was ever chosen in the Configuration page. */
export function hasSavedBackend(): boolean {
  return existsSync(pointerFile());
}

export function getBackendName(): string {
  return envValue('KASSANDRA_STORAGE') ?? readPointer()?.backend ?? DEFAULT_BACKEND;
}

export function defaultSqlitePath(): string {
  return path.join(getConfigDir(), SQLITE_FILE_NAME);
}

/** The SQLite database file in use: KASSANDRA_SQLITE_PATH, else the saved one, else `kassandra.db` in the config directory. */
export function getSqlitePath(): string {
  return envValue('KASSANDRA_SQLITE_PATH') ?? readPointer()?.sqlitePath ?? defaultSqlitePath();
}

/** True when KASSANDRA_SQLITE_PATH fixes the database path. */
export function isSqlitePathLocked(): boolean {
  return envValue('KASSANDRA_SQLITE_PATH') !== null;
}

/**
 * The connection for `dialect`: KASSANDRA_DB_URL (its schema overridden by
 * KASSANDRA_DB_SCHEMA), else the one saved on the Configuration page, else null.
 * Throws if KASSANDRA_DB_URL is not a URL of that dialect. Contains the password.
 */
export function getSqlConnection(dialect: SqlDialect): SqlConnection | null {
  const url = envValue('KASSANDRA_DB_URL');
  const schema = envValue('KASSANDRA_DB_SCHEMA');
  const connection = url ? parseConnectionUrl(url, dialect) : readPointer()?.sql;
  if (!connection || connection.dialect !== dialect) return null;
  return schema ? validateConnection({ ...connection, schema }) : connection;
}

/** Which database KASSANDRA_DB_URL is for, judging by its scheme; null if it is unset or unrecognised. */
export function getSqlUrlDialect(): SqlDialect | null {
  const url = envValue('KASSANDRA_DB_URL');
  if (!url) return null;
  const scheme = url.split(':', 1)[0]?.toLowerCase();
  return scheme === 'postgres' || scheme === 'postgresql' ? 'postgres' : scheme === 'mysql' || scheme === 'mariadb' ? 'mysql' : null;
}

/** The connection saved on the Configuration page, whatever its dialect; null if none. */
export function getSavedSqlConnection(): SqlConnection | null {
  return readPointer()?.sql ?? null;
}

/** True when KASSANDRA_DB_URL fixes the connection. */
export function isSqlLocked(): boolean {
  return envValue('KASSANDRA_DB_URL') !== null;
}

/** True when KASSANDRA_DB_SCHEMA fixes the PostgreSQL schema. */
export function isSqlSchemaLocked(): boolean {
  return envValue('KASSANDRA_DB_SCHEMA') !== null;
}

export function saveBackend(choice: BackendChoice): void {
  mkdirSync(defaultConfigDir(), { recursive: true });
  // The mode only applies when the file is created, so tighten an existing one too.
  writeFileSync(pointerFile(), `${JSON.stringify(choice, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  chmodSync(pointerFile(), 0o600);
}
