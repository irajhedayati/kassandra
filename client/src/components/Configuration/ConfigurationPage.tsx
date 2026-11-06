/**
 * Configuration page. Shown on its own on the first run, and from the gear in
 * the sidebar afterwards. Holds the appearance, the storage backend (files or
 * SQLite) and the location of the configuration.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChangeLocationResult, SetupInfo } from '@kassandra/shared';
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

type Backend = 'file' | 'sqlite';

const BACKEND_OPTIONS: { value: Backend; label: string; hint: string }[] = [
  { value: 'file', label: 'JSON files', hint: 'One JSON file per document in the location below' },
  { value: 'sqlite', label: 'SQLite', hint: 'A single SQLite database file' },
];

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
  const [backend, setBackend] = useState<Backend>(setup.backend === 'sqlite' ? 'sqlite' : 'file');
  const [sqlitePath, setSqlitePath] = useState(setup.sqlitePath);
  const [migrate, setMigrate] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const { appearance, setAppearance } = useAppearance();

  // Follow the server when the saved settings change.
  useEffect(() => setLocation(setup.location), [setup.location]);
  useEffect(() => {
    setBackend(setup.backend === 'sqlite' ? 'sqlite' : 'file');
    setSqlitePath(setup.sqlitePath);
  }, [setup.backend, setup.sqlitePath]);

  // The location is that of the JSON files, so it can only be edited while they are in use.
  const locationEditable = !setup.locked && setup.backend === 'file' && backend === 'file';
  const backendChanged = backend !== setup.backend || (backend === 'sqlite' && sqlitePath.trim() !== setup.sqlitePath);
  const locationChanged = locationEditable && location.trim() !== setup.location;

  const save = useMutation({
    mutationFn: async () => {
      if (backendChanged || (backend === 'sqlite' && setup.firstRun)) {
        return setStorageBackend({ backend, sqlitePath: backend === 'sqlite' ? sqlitePath : undefined, migrate });
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
  const empty = backend === 'sqlite' ? sqlitePath.trim() === '' : location.trim() === '';
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
                onChange={() => setBackend(o.value)}
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
