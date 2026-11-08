/**
 * First-run state and moving the configuration to another directory
 * (the Configuration page).
 */
import type { ChangeLocationResult, ChangeStorageRequest, SetupInfo } from '@kassandra/shared';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_POSTGRES_SCHEMA,
  defaultSqlitePath,
  getBackendName,
  getPostgresSchema,
  getPostgresUrl,
  getSqlitePath,
  hasSavedBackend,
  isBackendLocked,
  isPostgresSchemaLocked,
  isPostgresUrlLocked,
  isSqlitePathLocked,
  maskPostgresUrl,
  saveBackend,
} from './backend.js';
import { FileStorage } from './fileStorage.js';
import {
  defaultConfigDir,
  ensureWritableDir,
  expandLocation,
  getConfigDir,
  hasSavedLocation,
  isLocationLocked,
  LocationError,
  saveLocation,
} from './location.js';
import { runMigrations } from './migrations/index.js';
import { serialize } from './serial.js';
import { DocumentRepository } from './documentRepository.js';
import { getRepository } from './registry.js';
import type { ConfigRepository } from './repository.js';
import { closeSharedPostgresRepository, PostgresRepository } from './postgres/repository.js';
import { closeSharedSqliteRepository, SqliteRepository } from './sqlite/repository.js';
import type { ConfigStorage } from './storage.js';

let firstRun: boolean | null = null;

function detectFirstRun(): boolean {
  return (
    !isLocationLocked() &&
    !isBackendLocked() &&
    !hasSavedLocation() &&
    !hasSavedBackend() &&
    !existsSync(path.join(defaultConfigDir(), 'config.json'))
  );
}

/**
 * Decide whether this is a first run. Call once at startup, before anything
 * creates the default configuration, so an existing install is not mistaken
 * for a new one (or the other way around).
 */
export function initSetupState(): void {
  firstRun = detectFirstRun();
}

export function getSetupInfo(): SetupInfo {
  firstRun ??= detectFirstRun();
  return {
    firstRun,
    location: getConfigDir(),
    defaultLocation: defaultConfigDir(),
    locked: isLocationLocked(),
    backend: getBackendName(),
    backendLocked: isBackendLocked(),
    sqlitePath: getSqlitePath(),
    defaultSqlitePath: defaultSqlitePath(),
    sqlitePathLocked: isSqlitePathLocked(),
    postgresUrl: maskPostgresUrl(getPostgresUrl() ?? ''),
    postgresUrlLocked: isPostgresUrlLocked(),
    postgresSchema: getPostgresSchema(),
    postgresSchemaLocked: isPostgresSchemaLocked(),
  };
}

/** Copy every document (earlier backups excluded) and the version; returns how many documents. */
async function copyConfiguration(from: ConfigStorage, to: ConfigStorage): Promise<number> {
  let copied = 0;
  for (const key of (await from.list('')).filter((k) => !k.startsWith('backups/'))) {
    const value = await from.get(key);
    if (value !== undefined) await to.put(key, value);
    copied++;
  }
  const version = await from.getVersion();
  if (version) await to.setVersion(version);
  return copied;
}

/**
 * Switch the configuration to `input`. A location that already holds a
 * configuration is used as is; an empty one receives a copy of the current
 * configuration (backups excluded, the old location is left untouched). The
 * new location is migrated to the running version before it becomes active.
 */
export function changeLocation(input: string): Promise<ChangeLocationResult> {
  return serialize(async () => {
    if (isLocationLocked()) {
      throw new LocationError('The location is set by KASSANDRA_HOME and cannot be changed here', 409);
    }
    if (getBackendName() !== 'file') {
      throw new LocationError('The location only applies to the file backend; switch to it first', 409);
    }
    const target = expandLocation(input);
    await ensureWritableDir(target);

    const source = path.resolve(getConfigDir());
    let copied = 0;
    let existing = false;
    if (target !== source) {
      const from = new FileStorage(source);
      const to = new FileStorage(target);
      existing = (await to.list('')).length > 0;
      if (!existing) {
        copied = await copyConfiguration(from, to);
      }
      await runMigrations(to);
    }

    saveLocation(target);
    firstRun = false;
    return { ...getSetupInfo(), copied, existing };
  });
}

/**
 * Switch the storage backend. A target that already holds a configuration is
 * used as is; an empty one receives a copy of the current configuration
 * (unless `migrate` is false). The target is migrated to the running version
 * before it becomes active, and the previous storage is left untouched.
 */
export function changeStorage(request: ChangeStorageRequest): Promise<ChangeLocationResult> {
  return serialize(async () => {
    if (isBackendLocked()) {
      throw new LocationError('The storage backend is set by KASSANDRA_STORAGE and cannot be changed here', 409);
    }
    const { backend, migrate = true } = request;
    if (backend !== 'file' && backend !== 'sqlite' && backend !== 'postgres') {
      throw new LocationError('Backend must be "file", "sqlite" or "postgres"', 400);
    }

    let sqlitePath: string | undefined;
    let postgres: { url: string; schema: string } | undefined;
    let target: ConfigRepository;
    if (backend === 'sqlite') {
      sqlitePath = isSqlitePathLocked() ? getSqlitePath() : expandLocation(request.sqlitePath ?? defaultSqlitePath());
      target = await openSqlite(sqlitePath);
    } else if (backend === 'postgres') {
      postgres = resolvePostgres(request);
      target = openPostgres(postgres);
    } else {
      target = new DocumentRepository(new FileStorage(getConfigDir()));
    }

    try {
      const unchanged =
        backend === getBackendName() &&
        (backend === 'file' ||
          (backend === 'sqlite' && sqlitePath === getSqlitePath()) ||
          (backend === 'postgres' && postgres?.url === getPostgresUrl() && postgres.schema === getPostgresSchema()));
      let copied = 0;
      let existing = false;
      if (!unchanged) {
        await migrateTarget(target, backend);
        existing = !(await target.isEmpty());
        if (!existing && migrate) {
          const snapshot = await getRepository().exportSnapshot();
          await target.importSnapshot(snapshot);
          copied = snapshot.settings.connections.length + snapshot.settings.saved_queries.length + snapshot.tables.length;
        }
      }
      saveBackend({ backend, sqlitePath, postgresUrl: postgres?.url, postgresSchema: postgres?.schema });
      firstRun = false;
      return { ...getSetupInfo(), copied, existing };
    } finally {
      target.close();
      // Let the next request open the database that is now active.
      closeSharedSqliteRepository();
      closeSharedPostgresRepository();
    }
  });
}

/** The URL and schema to use: what the request gives, else (for the URL) what is configured; environment variables win. */
function resolvePostgres(request: ChangeStorageRequest): { url: string; schema: string } {
  const current = getPostgresUrl();
  const requested = request.postgresUrl?.trim();
  // The browser only ever sees the masked URL, so sending it back means "keep the configured one".
  const keep = !requested || (current !== null && requested === maskPostgresUrl(current));
  const url = isPostgresUrlLocked() ? current : keep ? current : requested;
  if (!url) throw new LocationError('Enter the PostgreSQL connection URL', 400);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LocationError('The PostgreSQL URL is not valid; expected postgres://user:password@host:5432/database', 400);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new LocationError('The PostgreSQL URL must start with postgres:// or postgresql://', 400);
  }
  const schema = isPostgresSchemaLocked() ? getPostgresSchema() : request.postgresSchema?.trim() || DEFAULT_POSTGRES_SCHEMA;
  return { url, schema };
}

function openPostgres({ url, schema }: { url: string; schema: string }): PostgresRepository {
  try {
    return new PostgresRepository(url, { schema });
  } catch (err) {
    throw new LocationError(err instanceof Error ? err.message : String(err), 400);
  }
}

/** Migrate a switch target; a PostgreSQL server that cannot be reached is the user's input to fix, not a server error. */
async function migrateTarget(target: ConfigRepository, backend: string): Promise<void> {
  try {
    await target.migrate();
  } catch (err) {
    if (backend !== 'postgres') throw err;
    throw new LocationError(`Cannot use ${target.description}: ${err instanceof Error ? err.message : String(err)}`, 400);
  }
}

async function openSqlite(file: string): Promise<SqliteRepository> {
  try {
    if (existsSync(file) && statSync(file).isDirectory()) throw new Error('is a directory');
    await ensureWritableDir(path.dirname(file));
    return new SqliteRepository(file);
  } catch (err) {
    if (err instanceof LocationError) throw err;
    throw new LocationError(`Cannot use ${file}: ${err instanceof Error ? err.message : String(err)}`, 400);
  }
}
