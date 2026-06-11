/**
 * Modal-style form for adding, editing, and deleting connection profiles.
 *
 * Mirrors the legacy Streamlit "Manage Connections" expander
 * (legacy/src/view/connection_form.py).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ConnectionProfile,
  ConsistencyLevel,
  SslProtocol,
} from '@py-sandra/shared';
import { DEFAULT_PROFILE } from '@py-sandra/shared';
import {
  createProfile,
  deleteProfile,
  updateProfile,
} from '../../api/connection.js';
import { ApiError } from '../../api/client.js';

const CONSISTENCY_LEVELS: ConsistencyLevel[] = [
  'ANY',
  'ONE',
  'TWO',
  'THREE',
  'QUORUM',
  'ALL',
  'LOCAL_QUORUM',
  'EACH_QUORUM',
  'SERIAL',
  'LOCAL_SERIAL',
  'LOCAL_ONE',
];

const SSL_PROTOCOLS: SslProtocol[] = [
  'PROTOCOL_TLS',
  'PROTOCOL_TLS_CLIENT',
  'PROTOCOL_TLS_SERVER',
  'PROTOCOL_TLSv1',
  'PROTOCOL_TLSv1_1',
  'PROTOCOL_TLSv1_2',
  'PROTOCOL_SSLv23',
];

interface FormState {
  name: string;
  hostsText: string;
  port: number;
  username: string;
  password: string;
  ssl_enabled: boolean;
  ssl_protocol: SslProtocol;
  ssl_cert_path: string;
  default_keyspace: string;
  consistency_level: ConsistencyLevel;
  connection_timeout: number;
  protocol_version: number;
}

function profileToForm(profile: ConnectionProfile | null): FormState {
  const base = profile ?? DEFAULT_PROFILE;
  return {
    name: base.name,
    hostsText: base.hosts.join(', '),
    port: base.port,
    username: base.username,
    password: base.password,
    ssl_enabled: base.ssl_enabled,
    ssl_protocol: base.ssl_protocol,
    ssl_cert_path: base.ssl_cert_path,
    default_keyspace: base.default_keyspace,
    consistency_level: base.consistency_level,
    connection_timeout: base.connection_timeout,
    protocol_version: base.protocol_version,
  };
}

function validate(form: FormState): { profile: ConnectionProfile } | { error: string } {
  if (!form.name.trim()) return { error: 'Profile name is required.' };
  const hosts = form.hostsText
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  if (hosts.length === 0) return { error: 'At least one host is required.' };
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
    return { error: 'Port must be an integer between 1 and 65535.' };
  }
  if (
    !Number.isInteger(form.connection_timeout) ||
    form.connection_timeout < 1 ||
    form.connection_timeout > 300
  ) {
    return { error: 'Connection timeout must be 1-300 seconds.' };
  }
  if (
    !Number.isInteger(form.protocol_version) ||
    form.protocol_version < 1 ||
    form.protocol_version > 5
  ) {
    return { error: 'Protocol version must be 1-5.' };
  }
  const profile: ConnectionProfile = {
    name: form.name.trim(),
    hosts,
    port: form.port,
    username: form.username,
    password: form.password,
    ssl_enabled: form.ssl_enabled,
    ssl_protocol: form.ssl_protocol,
    ssl_cert_path: form.ssl_cert_path,
    default_keyspace: form.default_keyspace,
    consistency_level: form.consistency_level,
    connection_timeout: form.connection_timeout,
    protocol_version: form.protocol_version,
  };
  return { profile };
}

interface Props {
  open: boolean;
  onClose: () => void;
  initial: ConnectionProfile | null;
}

export function ConnectionForm({ open, onClose, initial }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => profileToForm(initial));
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;
  const originalName = useMemo(() => initial?.name ?? '', [initial]);

  useEffect(() => {
    if (open) {
      setForm(profileToForm(initial));
      setError(null);
    }
  }, [open, initial]);

  const saveMutation = useMutation({
    mutationFn: async (profile: ConnectionProfile) => {
      if (isEdit) {
        return updateProfile(originalName, profile);
      }
      return createProfile(profile);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['connection', 'status'] });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProfile(originalName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['connection', 'status'] });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = validate(form);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    saveMutation.mutate(result.profile);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const saving = saveMutation.isPending;
  const deleting = deleteMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">
            {isEdit ? `Edit profile: ${originalName}` : 'New connection profile'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900"
            aria-label="Close"
          >
            X
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 p-5">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              disabled={isEdit}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
              required
            />
          </Field>

          <Field label="Hosts (comma-separated)">
            <input
              type="text"
              value={form.hostsText}
              onChange={(e) => update('hostsText', e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="127.0.0.1, host2.example.com"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Port">
              <input
                type="number"
                value={form.port}
                onChange={(e) => update('port', Number(e.target.value))}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                min={1}
                max={65535}
              />
            </Field>
            <Field label="Default keyspace">
              <input
                type="text"
                value={form.default_keyspace}
                onChange={(e) => update('default_keyspace', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <input
                type="text"
                value={form.username}
                onChange={(e) => update('username', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                autoComplete="off"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                autoComplete="off"
              />
            </Field>
          </div>

          <Field label="">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.ssl_enabled}
                onChange={(e) => update('ssl_enabled', e.target.checked)}
              />
              Enable SSL
            </label>
          </Field>

          {form.ssl_enabled && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="SSL protocol">
                <select
                  value={form.ssl_protocol}
                  onChange={(e) => update('ssl_protocol', e.target.value as SslProtocol)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  {SSL_PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="SSL cert path (optional)">
                <input
                  type="text"
                  value={form.ssl_cert_path}
                  onChange={(e) => update('ssl_cert_path', e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  placeholder="/path/to/ca.pem"
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Consistency">
              <select
                value={form.consistency_level}
                onChange={(e) =>
                  update('consistency_level', e.target.value as ConsistencyLevel)
                }
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {CONSISTENCY_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Timeout (s)">
              <input
                type="number"
                value={form.connection_timeout}
                onChange={(e) =>
                  update('connection_timeout', Number(e.target.value))
                }
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                min={1}
                max={300}
              />
            </Field>
            <Field label="Protocol version">
              <input
                type="number"
                value={form.protocol_version}
                onChange={(e) =>
                  update('protocol_version', Number(e.target.value))
                }
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                min={1}
                max={5}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-3">
            <div>
              {isEdit && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(`Delete profile "${originalName}"? This cannot be undone.`)
                    ) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleting || saving}
                  className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving || deleting}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      {label && (
        <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      )}
      {children}
    </label>
  );
}

// Re-export ApiError so callers can `instanceof` if needed.
export { ApiError };
