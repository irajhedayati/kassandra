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
 * fixes the SQLite database path the same way. The PostgreSQL URL and schema
 * (KASSANDRA_PG_URL, KASSANDRA_PG_SCHEMA) work likewise; since the URL usually
 * carries a password, the pointer file is readable by its owner only.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultConfigDir, getConfigDir } from './location.js';

export const DEFAULT_BACKEND = 'file';
const POINTER_FILE_NAME = '.backend';
const SQLITE_FILE_NAME = 'kassandra.db';

export interface BackendChoice {
  backend: string;
  /** Database file, for the `sqlite` backend. */
  sqlitePath?: string;
  /** Connection URL, for the `postgres` backend. Contains the password. */
  postgresUrl?: string;
  /** PostgreSQL schema holding the tables, for the `postgres` backend. */
  postgresSchema?: string;
}

const envValue = (name: string): string | null => process.env[name]?.trim() || null;

function pointerFile(): string {
  return path.join(defaultConfigDir(), POINTER_FILE_NAME);
}

function readPointer(): BackendChoice | null {
  try {
    const parsed = JSON.parse(readFileSync(pointerFile(), 'utf-8')) as Partial<BackendChoice>;
    return typeof parsed.backend === 'string' && parsed.backend !== ''
      ? {
          backend: parsed.backend,
          sqlitePath: typeof parsed.sqlitePath === 'string' ? parsed.sqlitePath : undefined,
          postgresUrl: typeof parsed.postgresUrl === 'string' ? parsed.postgresUrl : undefined,
          postgresSchema: typeof parsed.postgresSchema === 'string' ? parsed.postgresSchema : undefined,
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

export const DEFAULT_POSTGRES_SCHEMA = 'public';

/** The PostgreSQL URL in use: KASSANDRA_PG_URL, else the saved one, else null. Contains the password. */
export function getPostgresUrl(): string | null {
  return envValue('KASSANDRA_PG_URL') ?? readPointer()?.postgresUrl ?? null;
}

/** True when KASSANDRA_PG_URL fixes the connection URL. */
export function isPostgresUrlLocked(): boolean {
  return envValue('KASSANDRA_PG_URL') !== null;
}

/** PostgreSQL schema holding the tables: KASSANDRA_PG_SCHEMA, else the saved one, else `public`. */
export function getPostgresSchema(): string {
  return envValue('KASSANDRA_PG_SCHEMA') ?? readPointer()?.postgresSchema ?? DEFAULT_POSTGRES_SCHEMA;
}

/** True when KASSANDRA_PG_SCHEMA fixes the schema. */
export function isPostgresSchemaLocked(): boolean {
  return envValue('KASSANDRA_PG_SCHEMA') !== null;
}

/** `url` with its password replaced, safe to show. Unparseable input is returned as is (it holds no structure to leak). */
export function maskPostgresUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}

export function saveBackend(choice: BackendChoice): void {
  mkdirSync(defaultConfigDir(), { recursive: true });
  // The mode only applies when the file is created, so tighten an existing one too.
  writeFileSync(pointerFile(), `${JSON.stringify(choice, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  chmodSync(pointerFile(), 0o600);
}
