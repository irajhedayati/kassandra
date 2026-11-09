/**
 * First-run state and moving the configuration to another directory
 * (the Configuration page).
 */
import {
  DEFAULT_SQL_SCHEMA,
  SQL_DEFAULT_PORTS,
  type ChangeLocationResult,
  type ChangeStorageRequest,
  type SetupInfo,
  type SqlConnectionInfo,
  type SqlDialect,
} from '@kassandra/shared';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  defaultSqlitePath,
  getBackendName,
  getSavedSqlConnection,
  getSqlConnection,
  getSqlUrlDialect,
  getSqlitePath,
  hasSavedBackend,
  isBackendLocked,
  isSqlLocked,
  isSqlSchemaLocked,
  isSqlitePathLocked,
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
import { sameConnection, validateConnection, type SqlConnection } from './sql/connection.js';
import { closeSharedSqlRepository, SqlRepository } from './sql/repository.js';
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
    sql: getSqlInfo(),
    sqlLocked: isSqlLocked(),
    sqlSchemaLocked: isSqlSchemaLocked(),
  };
}

const isSqlDialect = (backend: string): backend is SqlDialect => backend === 'postgres' || backend === 'mysql';

/** The connection the form starts from: the one in use, else the last saved, else defaults. Never the password. */
function getSqlInfo(): SqlConnectionInfo {
  const backend = getBackendName();
  const dialect: SqlDialect = isSqlDialect(backend) ? backend : (getSqlUrlDialect() ?? getSavedSqlConnection()?.dialect ?? 'postgres');
  let connection: SqlConnection | null = null;
  try {
    connection = getSqlConnection(dialect);
  } catch {
    // KASSANDRA_DB_URL is for another database; the registry reports that when the backend is used.
  }
  return {
    dialect,
    host: connection?.host ?? 'localhost',
    port: connection?.port ?? SQL_DEFAULT_PORTS[dialect],
    database: connection?.database ?? '',
    username: connection?.username ?? '',
    ssl: connection?.ssl ?? false,
    schema: connection?.schema ?? DEFAULT_SQL_SCHEMA,
    hasPassword: Boolean(connection?.password),
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
    if (backend !== 'file' && backend !== 'sqlite' && !isSqlDialect(backend)) {
      throw new LocationError('Backend must be "file", "sqlite", "postgres" or "mysql"', 400);
    }

    let sqlitePath: string | undefined;
    let connection: SqlConnection | undefined;
    let target: ConfigRepository;
    if (backend === 'sqlite') {
      sqlitePath = isSqlitePathLocked() ? getSqlitePath() : expandLocation(request.sqlitePath ?? defaultSqlitePath());
      target = await openSqlite(sqlitePath);
    } else if (isSqlDialect(backend)) {
      connection = resolveConnection(backend, request);
      target = openSql(connection);
    } else {
      target = new DocumentRepository(new FileStorage(getConfigDir()));
    }

    try {
      const unchanged =
        backend === getBackendName() &&
        (backend === 'file' ||
          (backend === 'sqlite' && sqlitePath === getSqlitePath()) ||
          (connection !== undefined && sameConnectionAsActive(connection)));
      let copied = 0;
      let existing = false;
      if (!unchanged) {
        await migrateTarget(target, connection !== undefined);
        existing = !(await target.isEmpty());
        if (!existing && migrate) {
          const snapshot = await getRepository().exportSnapshot();
          await target.importSnapshot(snapshot);
          copied = snapshot.settings.connections.length + snapshot.settings.saved_queries.length + snapshot.tables.length;
        }
      }
      saveBackend({ backend, sqlitePath, sql: connection });
      firstRun = false;
      return { ...getSetupInfo(), copied, existing };
    } finally {
      target.close();
      // Let the next request open the database that is now active.
      closeSharedSqliteRepository();
      closeSharedSqlRepository();
    }
  });
}

function sameConnectionAsActive(connection: SqlConnection): boolean {
  const active = getSqlConnection(connection.dialect);
  return getBackendName() === connection.dialect && active !== null && sameConnection(active, connection);
}

/**
 * The connection to switch to: what KASSANDRA_DB_URL says if set, else the request.
 * A request without a password keeps the saved one (the browser never has it).
 */
function resolveConnection(dialect: SqlDialect, request: ChangeStorageRequest): SqlConnection {
  try {
    if (isSqlLocked()) {
      const fixed = getSqlConnection(dialect);
      if (fixed) return fixed;
    }
    const given = request.sql;
    if (!given) throw new Error('Enter the connection settings of the database');
    const saved = getSavedSqlConnection();
    return validateConnection({
      dialect,
      host: given.host.trim(),
      port: given.port,
      database: given.database.trim(),
      username: given.username,
      password: given.password ?? (saved?.dialect === dialect ? saved.password : ''),
      ssl: given.ssl,
      schema: isSqlSchemaLocked() ? (getSqlConnection(dialect)?.schema ?? DEFAULT_SQL_SCHEMA) : given.schema?.trim() || DEFAULT_SQL_SCHEMA,
    });
  } catch (err) {
    throw new LocationError(err instanceof Error ? err.message : String(err), 400);
  }
}

function openSql(connection: SqlConnection): SqlRepository {
  return new SqlRepository(connection);
}

/** Migrate a switch target; a database that cannot be reached is the user's input to fix, not a server error. */
async function migrateTarget(target: ConfigRepository, userSupplied: boolean): Promise<void> {
  try {
    await target.migrate();
  } catch (err) {
    if (!userSupplied) throw err;
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
