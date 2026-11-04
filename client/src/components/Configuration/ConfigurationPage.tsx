/**
 * Configuration page. Shown on its own on the first run, and from the gear in
 * the sidebar afterwards. Currently holds the location of the configuration
 * files.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChangeLocationResult, SetupInfo } from '@kassandra/shared';
import { setConfigLocation } from '../../api/setup.js';

interface Props {
  setup: SetupInfo;
  /** Called after a first-run setup is saved. */
  onDone: () => void;
  /** Leave the page without saving; not offered on the first run. */
  onClose?: () => void;
}

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
  const [message, setMessage] = useState<string | null>(null);

  // Follow the server when the saved location changes.
  useEffect(() => setLocation(setup.location), [setup.location]);

  const save = useMutation({
    mutationFn: setConfigLocation,
    onSuccess: async (result) => {
      setMessage(setup.firstRun ? null : describe(result));
      // Profiles, saved queries and table settings all come from the configuration.
      await queryClient.invalidateQueries();
      if (setup.firstRun) onDone();
    },
  });

  const unchanged = !setup.firstRun && location.trim() === setup.location;
  const disabled = setup.locked || save.isPending || location.trim() === '' || unchanged;

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

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          save.mutate(location);
        }}
      >
        <label htmlFor="config-location" className="block text-sm font-medium text-slate-700">
          Location of the configuration files
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="config-location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={setup.locked}
            spellCheck={false}
            className="w-full rounded border border-slate-300 px-3 py-1.5 font-mono text-sm disabled:bg-slate-100 disabled:text-slate-500"
          />
          <button
            type="button"
            onClick={() => setLocation(setup.defaultLocation)}
            disabled={setup.locked || location === setup.defaultLocation}
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
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
            The location is set by the <span className="font-mono">KASSANDRA_HOME</span> environment
            variable and cannot be changed here.
          </p>
        )}

        {save.isError && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {(save.error as Error).message}
          </p>
        )}
        {message && (
          <p className="mt-3 rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">
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
          {(setup.firstRun || !setup.locked) && (
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
