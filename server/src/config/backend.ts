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
 * fixes the SQLite database path the same way.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultConfigDir, getConfigDir } from './location.js';

export const DEFAULT_BACKEND = 'file';
const POINTER_FILE_NAME = '.backend';
const SQLITE_FILE_NAME = 'kassandra.db';

export interface BackendChoice {
  backend: string;
  /** Database file, for the `sqlite` backend. */
  sqlitePath?: string;
}

const envValue = (name: string): string | null => process.env[name]?.trim() || null;

function pointerFile(): string {
  return path.join(defaultConfigDir(), POINTER_FILE_NAME);
}

function readPointer(): BackendChoice | null {
  try {
    const parsed = JSON.parse(readFileSync(pointerFile(), 'utf-8')) as Partial<BackendChoice>;
    return typeof parsed.backend === 'string' && parsed.backend !== ''
      ? { backend: parsed.backend, sqlitePath: typeof parsed.sqlitePath === 'string' ? parsed.sqlitePath : undefined }
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

export function saveBackend(choice: BackendChoice): void {
  mkdirSync(defaultConfigDir(), { recursive: true });
  writeFileSync(pointerFile(), `${JSON.stringify(choice, null, 2)}\n`, 'utf-8');
}
