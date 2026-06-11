/**
 * Sidebar connection panel: profile dropdown, connect/disconnect buttons,
 * "Manage Connections" section that opens the ConnectionForm dialog.
 *
 * Mirrors legacy/src/view/main_view.py + connection_form.py.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectionProfile, ConnectionStatus } from '@py-sandra/shared';
import {
  connect,
  disconnect,
  getStatus,
  listProfiles,
} from '../../api/connection.js';
import { ConnectionForm } from '../Dialogs/ConnectionForm.js';
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
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Connection profile
        </label>
        {profiles.length === 0 ? (
          <p className="text-xs text-slate-500">
            No profiles yet. Create one to get started.
          </p>
        ) : (
          <select
            value={selectedName}
            onChange={(e) => setSelectedName(e.target.value)}
            disabled={connected || connectMutation.isPending}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-100"
          >
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-2">
        {connected ? (
          <button
            type="button"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (selectedName) connectMutation.mutate(selectedName);
            }}
            disabled={!selectedName || connectMutation.isPending}
            className="flex-1 rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {connectMutation.isPending ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>

      {connected && status && (
        <div className="rounded border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-800">
          Connected as <strong>{status.profileName}</strong>
          {status.keyspace && (
            <>
              {' '}
              · keyspace <strong>{status.keyspace}</strong>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}

      <details className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm">
        <summary className="cursor-pointer select-none text-slate-700">
          Manage connections
        </summary>
        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={openNew}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-100"
          >
            + New profile
          </button>
          <button
            type="button"
            onClick={openEdit}
            disabled={!selectedProfile || connected}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
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
