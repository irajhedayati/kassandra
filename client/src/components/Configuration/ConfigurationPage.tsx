/**
 * Configuration page. Shown on its own on the first run, and from the gear in
 * the sidebar afterwards. Holds the appearance, the storage backend (files,
 * SQLite, PostgreSQL or MySQL) and the location of the configuration.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SQL_SCHEMA,
  SQL_DEFAULT_PORTS,
  type ChangeLocationResult,
  type SetupInfo,
  type SqlDialect,
} from '@kassandra/shared';
import { setConfigLocation, setStorageBackend } from '../../api/setup.js';
import { useAppearance } from '../../state/appearance.js';
import { type Appearance } from '../../utils/appearance.js';

interface Props {
  setup: SetupInfo;
  /** Called after a first-run setup is saved. */
  onDone: () => void;
  /** Leave the page without saving; not offered on the first run. */
  onClose?: () => void;
}

const APPEARANCE_OPTIONS: { value: Appearance; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always use the light theme' },
  { value: 'dark', label: 'Dark', hint: 'Always use the dark theme' },
  { value: 'system', label: 'System', hint: 'Match the operating system' },
];

type Backend = 'file' | 'sqlite' | SqlDialect;

const BACKEND_OPTIONS: { value: Backend; label: string; hint: string }[] = [
  { value: 'file', label: 'JSON files', hint: 'One JSON file per document in the location below' },
  { value: 'sqlite', label: 'SQLite', hint: 'A single SQLite database file' },
  { value: 'postgres', label: 'PostgreSQL', hint: 'A PostgreSQL database, shared by every Kassandra that uses it' },
  { value: 'mysql', label: 'MySQL / MariaDB', hint: 'A MySQL or MariaDB database, shared by every Kassandra that uses it' },
];

const asBackend = (name: string): Backend =>
  name === 'sqlite' || name === 'postgres' || name === 'mysql' ? name : 'file';

const isSql = (backend: Backend): backend is SqlDialect => backend === 'postgres' || backend === 'mysql';

/** The connection form; the port is text while it is being typed. */
interface SqlForm {
  host: string;
  port: string;
  database: string;
  username: string;
  /** Empty keeps the saved password: the server never sends it back. */
  password: string;
  ssl: boolean;
  schema: string;
}

/** The form for `dialect`: the saved connection if it is for that dialect, else defaults. */
function sqlFormFor(setup: SetupInfo, dialect: SqlDialect): SqlForm {
  const saved = setup.sql;
  if (saved.dialect !== dialect) {
    return { host: 'localhost', port: String(SQL_DEFAULT_PORTS[dialect]), database: '', username: '', password: '', ssl: false, schema: DEFAULT_SQL_SCHEMA };
  }
  return { host: saved.host, port: String(saved.port), database: saved.database, username: saved.username, password: '', ssl: saved.ssl, schema: saved.schema };
}

const sameForm = (a: SqlForm, b: SqlForm) =>
  a.host.trim() === b.host.trim() &&
  a.port.trim() === b.port.trim() &&
  a.database.trim() === b.database.trim() &&
  a.username === b.username &&
  a.password === b.password &&
  a.ssl === b.ssl &&
  a.schema.trim() === b.schema.trim();

const FIELD_CLASS =
  'mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500';

function describe(result: ChangeLocationResult): string {
  if (result.existing) return 'Using the configuration already in that location.';
  if (result.copied > 0) {
    return `Copied ${result.copied} item${result.copied === 1 ? '' : 's'} from the previous location.`;
  }
  return 'Saved.';
}

export function ConfigurationPage({ setup, onDone, onClose }: Props) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useState(setup.location);
  const [backend, setBackend] = useState<Backend>(asBackend(setup.backend));
  const [sqlitePath, setSqlitePath] = useState(setup.sqlitePath);
  const initialDialect = isSql(asBackend(setup.backend)) ? (setup.backend as SqlDialect) : setup.sql.dialect;
  const [sqlForm, setSqlForm] = useState<SqlForm>(() => sqlFormFor(setup, initialDialect));
  const updateSql = (patch: Partial<SqlForm>) => setSqlForm((form) => ({ ...form, ...patch }));
  const [migrate, setMigrate] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const { appearance, setAppearance } = useAppearance();

  // Follow the server when the saved settings change.
  useEffect(() => setLocation(setup.location), [setup.location]);
  useEffect(() => {
    setBackend(asBackend(setup.backend));
    setSqlitePath(setup.sqlitePath);
    setSqlForm(sqlFormFor(setup, isSql(asBackend(setup.backend)) ? (setup.backend as SqlDialect) : setup.sql.dialect));
  }, [setup]);

  const chooseBackend = (next: Backend) => {
    setBackend(next);
    // Each database has its own defaults (port, schema) and its own saved connection.
    if (isSql(next)) setSqlForm(sqlFormFor(setup, next));
  };

  // The location is that of the JSON files, so it can only be edited while they are in use.
  const locationEditable = !setup.locked && setup.backend === 'file' && backend === 'file';
  const backendChanged =
    backend !== setup.backend ||
    (backend === 'sqlite' && sqlitePath.trim() !== setup.sqlitePath) ||
    (isSql(backend) && !sameForm(sqlForm, sqlFormFor(setup, backend)));
  const locationChanged = locationEditable && location.trim() !== setup.location;

  const save = useMutation({
    mutationFn: async () => {
      if (backendChanged || (backend !== 'file' && setup.firstRun)) {
        return setStorageBackend({
          backend,
          sqlitePath: backend === 'sqlite' ? sqlitePath : undefined,
          sql: isSql(backend)
            ? {
                host: sqlForm.host,
                port: Number(sqlForm.port),
                database: sqlForm.database,
                username: sqlForm.username,
                password: sqlForm.password === '' ? undefined : sqlForm.password,
                ssl: sqlForm.ssl,
                schema: backend === 'postgres' ? sqlForm.schema : undefined,
              }
            : undefined,
          migrate,
        });
      }
      return setConfigLocation(location);
    },
    onSuccess: async (result) => {
      setMessage(setup.firstRun ? null : describe(result));
      // Profiles, saved queries and table settings all come from the configuration.
      await queryClient.invalidateQueries();
      if (setup.firstRun) onDone();
    },
  });

  const unchanged = !setup.firstRun && !backendChanged && !locationChanged;
  const empty =
    backend === 'sqlite'
      ? sqlitePath.trim() === ''
      : isSql(backend)
        ? setup.sqlLocked
          ? false
          : sqlForm.host.trim() === '' || sqlForm.database.trim() === '' || !Number.isInteger(Number(sqlForm.port))
        : location.trim() === '';
  const canSave = !(setup.locked && setup.backendLocked);
  const disabled = !canSave || save.isPending || empty || unchanged;

  return (
    <div className="card mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold text-slate-900">
        {setup.firstRun ? 'Welcome to Kassandra' : 'Configuration'}
      </h1>
      {setup.firstRun && (
        <p className="mt-1 text-sm text-slate-600">
          Choose where Kassandra keeps its settings. You can change this later from the gear icon
          in the sidebar.
        </p>
      )}

      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-slate-700">Appearance</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {APPEARANCE_OPTIONS.map((o) => (
            <label
              key={o.value}
              title={o.hint}
              className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm ${
                appearance === o.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:text-blue-300'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="appearance"
                value={o.value}
                checked={appearance === o.value}
                onChange={() => setAppearance(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">Applies immediately and is remembered in this browser.</p>
      </fieldset>

      <fieldset className="mt-8" disabled={setup.backendLocked}>
        <legend className="text-sm font-medium text-slate-700">Storage</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {BACKEND_OPTIONS.map((o) => (
            <label
              key={o.value}
              title={o.hint}
              className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm ${
                backend === o.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:text-blue-300'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="backend"
                value={o.value}
                checked={backend === o.value}
                onChange={() => chooseBackend(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
        {setup.backendLocked && (
          <p className="mt-2 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 p-2 text-sm text-amber-800 dark:text-amber-200">
            The storage is set by the <span className="font-mono">KASSANDRA_STORAGE</span> environment
            variable and cannot be changed here.
          </p>
        )}
        {backend === 'sqlite' && (
          <div className="mt-3">
            <label htmlFor="config-sqlite-path" className="block text-sm font-medium text-slate-700">
              SQLite database file
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="config-sqlite-path"
                type="text"
                value={sqlitePath}
                onChange={(e) => setSqlitePath(e.target.value)}
                disabled={setup.sqlitePathLocked || setup.backendLocked}
                spellCheck={false}
                className="w-full rounded border border-slate-300 px-3 py-1.5 font-mono text-sm disabled:bg-slate-100 disabled:text-slate-500"
              />
              <button
                type="button"
                onClick={() => setSqlitePath(setup.defaultSqlitePath)}
                disabled={setup.sqlitePathLocked || setup.backendLocked || sqlitePath === setup.defaultSqlitePath}
                className="shrink-0 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Use default
              </button>
            </div>
            {setup.sqlitePathLocked && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                The path is set by <span className="font-mono">KASSANDRA_SQLITE_PATH</span>.
              </p>
            )}
            {backendChanged && (
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
                Copy the current configuration into the database if it is empty
              </label>
            )}
            <p className="mt-1 text-xs text-slate-500">
              A database that already holds a configuration is used as is. The previous files are left in place.
            </p>
          </div>
        )}
        {isSql(backend) && (
          <div className="mt-3">
            {setup.sqlLocked && (
              <p className="mb-2 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 p-2 text-sm text-amber-800 dark:text-amber-200">
                The connection is set by the <span className="font-mono">KASSANDRA_DB_URL</span> environment
                variable and cannot be changed here.
              </p>
            )}
            <fieldset disabled={setup.sqlLocked || setup.backendLocked} className="grid grid-cols-6 gap-3">
              <div className="col-span-4">
                <label htmlFor="config-sql-host" className="block text-sm font-medium text-slate-700">Host</label>
                <input id="config-sql-host" type="text" value={sqlForm.host} onChange={(e) => updateSql({ host: e.target.value })} spellCheck={false} className={`${FIELD_CLASS} font-mono`} />
              </div>
              <div className="col-span-2">
                <label htmlFor="config-sql-port" className="block text-sm font-medium text-slate-700">Port</label>
                <input id="config-sql-port" type="text" inputMode="numeric" value={sqlForm.port} onChange={(e) => updateSql({ port: e.target.value })} className={`${FIELD_CLASS} font-mono`} />
              </div>
              <div className="col-span-6">
                <label htmlFor="config-sql-database" className="block text-sm font-medium text-slate-700">Database</label>
                <input id="config-sql-database" type="text" value={sqlForm.database} onChange={(e) => updateSql({ database: e.target.value })} spellCheck={false} className={`${FIELD_CLASS} font-mono`} />
              </div>
              <div className="col-span-3">
                <label htmlFor="config-sql-username" className="block text-sm font-medium text-slate-700">User</label>
                <input id="config-sql-username" type="text" value={sqlForm.username} onChange={(e) => updateSql({ username: e.target.value })} spellCheck={false} autoComplete="off" className={`${FIELD_CLASS} font-mono`} />
              </div>
              <div className="col-span-3">
                <label htmlFor="config-sql-password" className="block text-sm font-medium text-slate-700">Password</label>
                <input
                  id="config-sql-password"
                  type="password"
                  value={sqlForm.password}
                  onChange={(e) => updateSql({ password: e.target.value })}
                  placeholder={setup.sql.dialect === backend && setup.sql.hasPassword ? 'Saved; leave empty to keep it' : ''}
                  autoComplete="new-password"
                  className={FIELD_CLASS}
                />
              </div>
              {backend === 'postgres' && (
                <div className="col-span-6">
                  <label htmlFor="config-sql-schema" className="block text-sm font-medium text-slate-700">Schema</label>
                  <input id="config-sql-schema" type="text" value={sqlForm.schema} onChange={(e) => updateSql({ schema: e.target.value })} disabled={setup.sqlSchemaLocked} spellCheck={false} className={`${FIELD_CLASS} font-mono`} />
                  {setup.sqlSchemaLocked && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      The schema is set by <span className="font-mono">KASSANDRA_DB_SCHEMA</span>.
                    </p>
                  )}
                </div>
              )}
              <label className="col-span-6 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={sqlForm.ssl} onChange={(e) => updateSql({ ssl: e.target.checked })} />
                Encrypt the connection with TLS and verify the server certificate
              </label>
            </fieldset>
            {backendChanged && (
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
                Copy the current configuration into the database if it is empty
              </label>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {backend === 'mysql'
                ? 'The database must already exist; the tables are created in it if they do not.'
                : 'The tables are created in the schema, which is created if it does not exist.'}{' '}
              A database that already holds a configuration is used as is. The password is saved in a file only
              your user can read. The previous storage is left in place.
            </p>
          </div>
        )}
      </fieldset>

      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          save.mutate();
        }}
      >
        {backend === 'file' && (
          <>
          <label htmlFor="config-location" className="block text-sm font-medium text-slate-700">
            Location of the configuration files
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="config-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={!locationEditable}
              spellCheck={false}
              className="w-full rounded border border-slate-300 px-3 py-1.5 font-mono text-sm disabled:bg-slate-100 disabled:text-slate-500"
            />
            <button
              type="button"
              onClick={() => setLocation(setup.defaultLocation)}
              disabled={!locationEditable || location === setup.defaultLocation}
              className="shrink-0 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use default
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Connection profiles, saved queries and table settings are stored here. Default:{' '}
            <span className="font-mono">{setup.defaultLocation}</span>. An existing configuration at
            the new location is used as is; otherwise the current one is copied there and the old
            files are left in place.
          </p>
          {setup.locked && (
            <p className="mt-2 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 p-2 text-sm text-amber-800 dark:text-amber-200">
              The location is set by the <span className="font-mono">KASSANDRA_HOME</span> environment
              variable and cannot be changed here.
            </p>
          )}
          </>
        )}

        {save.isError && (
          <p className="mt-3 rounded border border-red-300 dark:border-red-800 bg-red-50 p-2 text-sm text-red-700 dark:text-red-300">
            {(save.error as Error).message}
          </p>
        )}
        {message && (
          <p className="mt-3 rounded border border-green-300 dark:border-green-800 bg-green-50 p-2 text-sm text-green-800 dark:text-green-200">
            {message}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          {onClose && !setup.firstRun && (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          )}
          {canSave && (
            <button
              type="submit"
              disabled={disabled}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {save.isPending ? 'Saving…' : setup.firstRun ? 'Continue' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
