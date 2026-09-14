/**
 * Sidebar connection panel: profile dropdown, connect/disconnect buttons,
 * "Manage Connections" section that opens the ConnectionForm dialog.
 *
 * Mirrors legacy/src/view/main_view.py + connection_form.py.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlug, faPlugCircleXmark, faRotate } from '@fortawesome/free-solid-svg-icons';
import type { ConnectionProfile, ConnectionStatus } from '@kassandra/shared';
import {
  connect,
  disconnect,
  getStatus,
  listProfiles,
} from '../../api/connection.js';
import { ConnectionForm } from '../Dialogs/ConnectionForm.js';
import { SearchableSelect } from './SearchableSelect.js';
import { useSelection } from '../../state/selection.js';

export function ConnectionPanel() {
  const queryClient = useQueryClient();
  const { setKeyspace } = useSelection();
  const [selectedName, setSelectedName] = useState<string>('');
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null);
  const [dialogMode, setDialogMode] = useState<'closed' | 'new' | 'edit'>('closed');
  const [error, setError] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: listProfiles,
  });

  const statusQuery = useQuery<ConnectionStatus>({
    queryKey: ['connection', 'status'],
    queryFn: getStatus,
    refetchInterval: false,
  });

  const profiles = profilesQuery.data ?? [];
  const status = statusQuery.data;
  const connected = !!status?.connected;

  // Auto-select a sensible default when profiles load: prefer the
  // currently connected profile, otherwise the first one.
  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedName('');
      return;
    }
    if (selectedName && profiles.some((p) => p.name === selectedName)) return;
    if (status?.profileName && profiles.some((p) => p.name === status.profileName)) {
      setSelectedName(status.profileName);
      return;
    }
    const first = profiles[0];
    if (first) setSelectedName(first.name);
  }, [profiles, selectedName, status?.profileName]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.name === selectedName) ?? null,
    [profiles, selectedName],
  );

  const connectMutation = useMutation({
    mutationFn: (name: string) => connect(name),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['connection', 'status'] });
      await queryClient.invalidateQueries({ queryKey: ['connection', 'datacenters'] });
      await queryClient.invalidateQueries({ queryKey: ['schema'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: async () => {
      setError(null);
      setKeyspace(null);
      await queryClient.invalidateQueries({ queryKey: ['connection', 'status'] });
      await queryClient.invalidateQueries({ queryKey: ['connection', 'datacenters'] });
      await queryClient.invalidateQueries({ queryKey: ['schema'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async (name: string) => {
      await disconnect();
      await connect(name);
    },
    onSuccess: async () => {
      setError(null);
      setKeyspace(null);
      await queryClient.invalidateQueries({ queryKey: ['connection', 'status'] });
      await queryClient.invalidateQueries({ queryKey: ['connection', 'datacenters'] });
      await queryClient.invalidateQueries({ queryKey: ['schema'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  function openNew() {
    setEditingProfile(null);
    setDialogMode('new');
  }
  function openEdit() {
    if (!selectedProfile) return;
    setEditingProfile(selectedProfile);
    setDialogMode('edit');
  }
  function closeDialog() {
    setDialogMode('closed');
    setEditingProfile(null);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
          Connection profile
        </label>
        {profiles.length === 0 ? (
          <p className="text-xs text-slate-400">
            No profiles yet. Create one to get started.
          </p>
        ) : (
          <SearchableSelect
            value={selectedName || null}
            options={profiles.map((p) => p.name)}
            placeholder="Select a profile…"
            disabled={connected || connectMutation.isPending}
            onChange={(v) => setSelectedName(v ?? '')}
          />
        )}
      </div>

      <div className="flex gap-2">
        {connected ? (
          <>
            <button
              type="button"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending || reconnectMutation.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 transition hover:bg-slate-700 disabled:opacity-60"
            >
              <FontAwesomeIcon icon={faPlugCircleXmark} />
              {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (status?.profileName) reconnectMutation.mutate(status.profileName);
              }}
              disabled={!status?.profileName || disconnectMutation.isPending || reconnectMutation.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 transition hover:bg-slate-700 disabled:opacity-60"
            >
              <FontAwesomeIcon icon={faRotate} />
              {reconnectMutation.isPending ? 'Reconnecting...' : 'Reconnect'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (selectedName) connectMutation.mutate(selectedName);
            }}
            disabled={!selectedName || connectMutation.isPending}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
          >
            <FontAwesomeIcon icon={faPlug} />
            {connectMutation.isPending ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>

      {connected && status && (
        <div className="rounded-lg border border-green-700/50 bg-green-500/10 px-3 py-2 text-xs text-green-300">
          Connected as <strong className="text-green-200">{status.profileName}</strong>
          {status.keyspace && (
            <>
              {' '}
              · keyspace <strong className="text-green-200">{status.keyspace}</strong>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <details className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200">
        <summary className="cursor-pointer select-none text-slate-300">
          Manage connections
        </summary>
        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={openNew}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 transition hover:bg-slate-700"
          >
            + New profile
          </button>
          <button
            type="button"
            onClick={openEdit}
            disabled={!selectedProfile || connected}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 transition hover:bg-slate-700 disabled:opacity-50"
          >
            Edit selected
          </button>
        </div>
      </details>

      <ConnectionForm
        open={dialogMode !== 'closed'}
        onClose={closeDialog}
        initial={dialogMode === 'edit' ? editingProfile : null}
      />
    </div>
  );
}
