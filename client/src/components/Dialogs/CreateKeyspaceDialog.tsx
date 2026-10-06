/**
 * Create a keyspace (CQL CREATE KEYSPACE). Fields follow the DataStax reference:
 * https://docs.datastax.com/en/cql-oss/3.3/cql/cql_reference/cqlCreateKeyspace.html
 *
 * The "?" button toggles an inline guide explaining each option.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleQuestion, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import type { CreateKeyspaceRequest, ReplicationStrategy } from '@kassandra/shared';
import { createKeyspace } from '../../api/schema.js';
import { listDatacenters } from '../../api/connection.js';
import { OptionDropdown, type DropdownOption } from '../OptionDropdown.js';
import { useSelection } from '../../state/selection.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface DcRow {
  name: string;
  replicas: number;
}

const DOCS_URL =
  'https://docs.datastax.com/en/cql-oss/3.3/cql/cql_reference/cqlCreateKeyspace.html';
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

const STRATEGY_OPTIONS: DropdownOption<ReplicationStrategy>[] = [
  {
    value: 'SimpleStrategy',
    label: 'SimpleStrategy',
    helperText: 'One replication factor for the whole cluster; development or single datacenter',
  },
  {
    value: 'NetworkTopologyStrategy',
    label: 'NetworkTopologyStrategy',
    helperText: 'Replicas per datacenter; recommended for production',
  },
];

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export function CreateKeyspaceDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { setKeyspace } = useSelection();
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<ReplicationStrategy>('SimpleStrategy');
  const [replicationFactor, setReplicationFactor] = useState(1);
  const [dcs, setDcs] = useState<DcRow[]>([{ name: '', replicas: 3 }]);
  const [durableWrites, setDurableWrites] = useState(true);
  const [ifNotExists, setIfNotExists] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datacentersQuery = useQuery({
    queryKey: ['connection', 'datacenters'],
    queryFn: listDatacenters,
    enabled: open,
    retry: false,
  });
  const knownDcs = datacentersQuery.data?.datacenters ?? [];

  const request: CreateKeyspaceRequest = {
    name: name.trim(),
    strategy,
    ...(strategy === 'SimpleStrategy'
      ? { replicationFactor }
      : {
          datacenters: Object.fromEntries(
            dcs.filter((d) => d.name.trim()).map((d) => [d.name.trim(), d.replicas]),
          ),
        }),
    durableWrites,
    ifNotExists,
  };

  const mutation = useMutation({
    mutationFn: () => createKeyspace(request),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['schema', 'keyspaces'] });
      setKeyspace(result.keyspace);
      handleClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  function handleClose() {
    setName('');
    setStrategy('SimpleStrategy');
    setReplicationFactor(1);
    setDcs([{ name: '', replicas: 3 }]);
    setDurableWrites(true);
    setIfNotExists(false);
    setShowHelp(false);
    setError(null);
    mutation.reset();
    onClose();
  }

  function updateDc(i: number, patch: Partial<DcRow>) {
    setDcs((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const nameValid = NAME_PATTERN.test(request.name);
  const replicationValid =
    strategy === 'SimpleStrategy'
      ? replicationFactor >= 1
      : Object.keys(request.datacenters ?? {}).length > 0 &&
        dcs.every((d) => !d.name.trim() || d.replicas >= 1);
  const canSubmit = nameValid && replicationValid && !mutation.isPending;

  const replicationCql =
    strategy === 'SimpleStrategy'
      ? `{'class': 'SimpleStrategy', 'replication_factor': ${replicationFactor}}`
      : `{'class': 'NetworkTopologyStrategy'${Object.entries(request.datacenters ?? {})
          .map(([dc, n]) => `, '${dc.replace(/'/g, "''")}': ${n}`)
          .join('')}}`;
  const preview =
    `CREATE KEYSPACE ${ifNotExists ? 'IF NOT EXISTS ' : ''}"${request.name || 'name'}"\n` +
    `  WITH REPLICATION = ${replicationCql}\n` +
    `  AND DURABLE_WRITES = ${durableWrites};`;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Create keyspace</h2>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-label="Show help"
            aria-expanded={showHelp}
            title="Help"
            className={`text-lg transition ${showHelp ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600'}`}
          >
            <FontAwesomeIcon icon={faCircleQuestion} />
          </button>
        </div>

        {showHelp && (
          <div className="mt-3 space-y-2 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-slate-700">
            <p>
              A keyspace is the top-level container for tables. It defines how data is replicated
              across the cluster.
            </p>
            <p>
              <strong>Name</strong>: starts with a letter; letters, digits and underscores only;
              up to 48 characters. The name is created exactly as typed (case-sensitive).
            </p>
            <p>
              <strong>SimpleStrategy</strong>: one replication factor for the whole cluster.
              Fine for development and single-datacenter clusters, not for production
              multi-datacenter setups.
            </p>
            <p>
              <strong>NetworkTopologyStrategy</strong>: set replicas per datacenter. Recommended
              for production, even with one datacenter. Datacenter names must match the cluster
              exactly (case-sensitive); known ones are suggested below.
            </p>
            <p>
              <strong>Replication factor</strong>: how many nodes hold a copy of each row. 3 per
              datacenter is the usual production choice; it can't exceed the number of nodes you
              want to be able to serve reads and writes.
            </p>
            <p>
              <strong>Durable writes</strong>: when on (default), writes go to the commit log
              before acknowledgement. Turning it off risks data loss on a node crash. Only
              disable it if you understand the trade-off.
            </p>
            <p>
              <strong>IF NOT EXISTS</strong>: skip the error if a keyspace with this name already
              exists.
            </p>
            <p>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline"
              >
                CREATE KEYSPACE reference (DataStax)
              </a>
            </p>
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_keyspace"
              autoFocus
            />
            {name.trim() !== '' && !nameValid && (
              <p className="mt-1 text-xs text-red-600">
                Start with a letter; use only letters, digits and underscores (max 48).
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Replication strategy
            </label>
            <OptionDropdown
              label="Replication strategy"
              value={strategy}
              options={STRATEGY_OPTIONS}
              onChange={setStrategy}
              buttonClassName="w-full px-3 py-2"
              listClassName="w-auto"
            />
          </div>

          {strategy === 'SimpleStrategy' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Replication factor
              </label>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={replicationFactor}
                onChange={(e) => setReplicationFactor(Number(e.target.value))}
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Replicas per datacenter
              </label>
              <datalist id="kassandra-keyspace-dcs">
                {knownDcs.map((dc) => (
                  <option key={dc} value={dc} />
                ))}
              </datalist>
              <div className="space-y-2">
                {dcs.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      list="kassandra-keyspace-dcs"
                      placeholder="datacenter name"
                      value={row.name}
                      onChange={(e) => updateDc(i, { name: e.target.value })}
                    />
                    <input
                      type="number"
                      min={1}
                      className={`${inputClass} w-24`}
                      value={row.replicas}
                      onChange={(e) => updateDc(i, { replicas: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      onClick={() => setDcs((rows) => rows.filter((_, idx) => idx !== i))}
                      disabled={dcs.length === 1}
                      aria-label="Remove datacenter"
                      className="text-slate-400 hover:text-red-600 disabled:opacity-40"
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDcs((rows) => [...rows, { name: '', replicas: 3 }])}
                className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
              >
                <FontAwesomeIcon icon={faPlus} /> Add datacenter
              </button>
            </div>
          )}

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={durableWrites}
                onChange={(e) => setDurableWrites(e.target.checked)}
              />
              Durable writes
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={ifNotExists}
                onChange={(e) => setIfNotExists(e.target.checked)}
              />
              IF NOT EXISTS
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              CQL preview
            </label>
            <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">
              {preview}
            </pre>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
