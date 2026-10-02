/**
 * Create a table (CQL CREATE TABLE). Fields follow the DataStax reference:
 * https://docs.datastax.com/en/cql-oss/3.3/cql/cql_reference/cqlCreateTable.html
 *
 * The preview is produced by the same builder the server runs, so validation
 * errors surface live. The "?" button toggles an inline guide.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleQuestion, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { buildCreateTableCql } from '@kassandra/shared';
import type {
  ClusteringOrder,
  ColumnKind,
  CompactionStrategy,
  CompressionAlgorithm,
  CreateTableRequest,
} from '@kassandra/shared';
import { createTable } from '../../api/schema.js';
import { OptionDropdown, type DropdownOption } from '../OptionDropdown.js';
import { useSelection } from '../../state/selection.js';

interface Props {
  open: boolean;
  keyspace: string | null;
  onClose: () => void;
}

interface ColumnRow {
  name: string;
  kind: ColumnKind;
  base: string;
  /** Element type for list/set, key type for map. */
  elem: string;
  /** Value type for map. */
  value: string;
  frozen: boolean;
  order: ClusteringOrder;
}

const DOCS_URL =
  'https://docs.datastax.com/en/cql-oss/3.3/cql/cql_reference/cqlCreateTable.html';

const SCALARS: [string, string][] = [
  ['text', 'UTF-8 string'],
  ['int', '32-bit signed integer'],
  ['bigint', '64-bit signed integer'],
  ['smallint', '16-bit signed integer'],
  ['tinyint', '8-bit signed integer'],
  ['varint', 'Arbitrary-precision integer'],
  ['decimal', 'Variable-precision decimal'],
  ['double', '64-bit floating point'],
  ['float', '32-bit floating point'],
  ['boolean', 'true or false'],
  ['uuid', 'Type 1 or 4 UUID'],
  ['timeuuid', 'Type 1 UUID, sortable by time'],
  ['timestamp', 'Date and time, millisecond precision'],
  ['date', 'Calendar date'],
  ['time', 'Time of day, nanosecond precision'],
  ['duration', 'Months, days and nanoseconds'],
  ['inet', 'IPv4 or IPv6 address'],
  ['blob', 'Arbitrary bytes'],
  ['ascii', 'ASCII string'],
  ['counter', 'Distributed counter (counter tables only)'],
];
const TYPE_OPTIONS: DropdownOption<string>[] = [
  ...SCALARS.map(([value, helperText]) => ({ value, label: value, helperText })),
  { value: 'list', label: 'list', helperText: 'Ordered collection, duplicates allowed' },
  { value: 'set', label: 'set', helperText: 'Unordered collection of unique values' },
  { value: 'map', label: 'map', helperText: 'Key/value pairs' },
];
// Element types allowed inside collections (counter is not).
const ELEM_OPTIONS = TYPE_OPTIONS.filter(
  (o) => !['counter', 'list', 'set', 'map'].includes(o.value),
);

const KIND_OPTIONS: DropdownOption<ColumnKind>[] = [
  { value: 'partition_key', label: 'Partition key', helperText: 'Decides which nodes store the row' },
  { value: 'clustering', label: 'Clustering', helperText: 'Sorts rows within a partition' },
  { value: 'regular', label: 'Regular', helperText: 'Ordinary data column' },
  { value: 'static', label: 'Static', helperText: 'One value shared by the whole partition' },
];

const ORDER_OPTIONS: DropdownOption<ClusteringOrder>[] = [
  { value: 'ASC', label: 'ASC', helperText: 'Smallest first' },
  { value: 'DESC', label: 'DESC', helperText: 'Largest first' },
];

const NO_OPTION = 'default';
const COMPACTION_OPTIONS: DropdownOption<string>[] = [
  { value: NO_OPTION, label: 'Default', helperText: 'Server default (SizeTieredCompactionStrategy)' },
  { value: 'SizeTieredCompactionStrategy', label: 'SizeTiered', helperText: 'Write-heavy workloads' },
  { value: 'LeveledCompactionStrategy', label: 'Leveled', helperText: 'Read-heavy workloads, more I/O' },
  { value: 'TimeWindowCompactionStrategy', label: 'TimeWindow', helperText: 'Time series with TTL' },
];
const COMPRESSION_OPTIONS: DropdownOption<string>[] = [
  { value: NO_OPTION, label: 'Default', helperText: 'Server default (LZ4)' },
  { value: 'LZ4Compressor', label: 'LZ4', helperText: 'Fast, moderate ratio' },
  { value: 'SnappyCompressor', label: 'Snappy', helperText: 'Fast, similar to LZ4' },
  { value: 'DeflateCompressor', label: 'Deflate', helperText: 'Best ratio, slower' },
  { value: 'none', label: 'None', helperText: 'Disable compression' },
];

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const newRow = (kind: ColumnKind = 'regular'): ColumnRow => ({
  name: '',
  kind,
  base: 'text',
  elem: 'text',
  value: 'text',
  frozen: false,
  order: 'ASC',
});

function rowType(r: ColumnRow): string {
  let t = r.base;
  if (r.base === 'list' || r.base === 'set') t = `${r.base}<${r.elem}>`;
  if (r.base === 'map') t = `map<${r.elem}, ${r.value}>`;
  return r.frozen && t !== r.base ? `frozen<${t}>` : t;
}

function optionalInt(s: string): number | undefined {
  return s.trim() === '' ? undefined : Number(s);
}

export function CreateTableDialog({ open, keyspace, onClose }: Props) {
  const queryClient = useQueryClient();
  const { setTable } = useSelection();
  const [name, setName] = useState('');
  const [ifNotExists, setIfNotExists] = useState(false);
  const [rows, setRows] = useState<ColumnRow[]>([newRow('partition_key')]);
  const [comment, setComment] = useState('');
  const [ttl, setTtl] = useState('');
  const [gcGrace, setGcGrace] = useState('');
  const [compaction, setCompaction] = useState(NO_OPTION);
  const [compression, setCompression] = useState(NO_OPTION);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request: CreateTableRequest = {
    keyspace: keyspace ?? '',
    name: name.trim(),
    ifNotExists,
    columns: rows.map((r) => ({
      name: r.name.trim(),
      type: rowType(r),
      kind: r.kind,
      ...(r.kind === 'clustering' ? { order: r.order } : {}),
    })),
    ...(comment.trim() ? { comment } : {}),
    ...(optionalInt(ttl) !== undefined ? { defaultTimeToLive: optionalInt(ttl)! } : {}),
    ...(optionalInt(gcGrace) !== undefined ? { gcGraceSeconds: optionalInt(gcGrace)! } : {}),
    ...(compaction !== NO_OPTION ? { compaction: compaction as CompactionStrategy } : {}),
    ...(compression !== NO_OPTION ? { compression: compression as CompressionAlgorithm } : {}),
  };

  let preview = '';
  let validationError: string | null = null;
  try {
    preview = buildCreateTableCql(request) + ';';
  } catch (err) {
    validationError = err instanceof Error ? err.message : String(err);
  }

  const mutation = useMutation({
    mutationFn: () => createTable(request),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['schema', 'tables', keyspace] });
      setTable(result.table);
      handleClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  function handleClose() {
    setName('');
    setIfNotExists(false);
    setRows([newRow('partition_key')]);
    setComment('');
    setTtl('');
    setGcGrace('');
    setCompaction(NO_OPTION);
    setCompression(NO_OPTION);
    setShowHelp(false);
    setError(null);
    mutation.reset();
    onClose();
  }

  const update = (i: number, patch: Partial<ColumnRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Create table <span className="font-mono text-base text-slate-500">in {keyspace}</span>
          </h2>
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
              <strong>Primary key</strong>: every table needs at least one partition key column.
              Partition keys decide where a row lives; with several, they are combined into a
              composite partition key. Clustering columns sort rows inside a partition, in the
              order the columns are listed here, and can be ASC or DESC.
            </p>
            <p>
              <strong>Static</strong> columns hold one value per partition and need at least one
              clustering column. <strong>Counter</strong> columns can only be used in tables whose
              other columns are all part of the primary key.
            </p>
            <p>
              <strong>Collections</strong> (list, set, map) can't be part of the primary key unless
              frozen. Freezing stores the collection as a single value that is replaced as a whole.
            </p>
            <p>
              <strong>Options</strong> are all optional. Default TTL expires rows after that many
              seconds (0 means never). GC grace seconds is how long tombstones are kept before
              they can be purged (default 864000, ten days). Compaction and compression use the
              server defaults unless you pick one.
            </p>
            <p>
              The names are created exactly as typed (case-sensitive). The CQL preview shows the
              statement that will run and explains anything that is invalid.
            </p>
            <p>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                CREATE TABLE reference (DataStax)
              </a>
            </p>
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Table name</label>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_table"
                autoFocus
              />
            </div>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={ifNotExists}
                onChange={(e) => setIfNotExists(e.target.checked)}
              />
              IF NOT EXISTS
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Columns</label>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputClass} min-w-0 flex-1 basis-32 py-1`}
                    placeholder="column name"
                    value={r.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                  <OptionDropdown
                    label="Column kind"
                    value={r.kind}
                    options={KIND_OPTIONS}
                    onChange={(kind) => update(i, { kind })}
                    buttonClassName="w-36"
                  />
                  <OptionDropdown
                    label="Column type"
                    value={r.base}
                    options={TYPE_OPTIONS}
                    onChange={(base) => update(i, { base })}
                    buttonClassName="w-28"
                  />
                  {(r.base === 'list' || r.base === 'set' || r.base === 'map') && (
                    <>
                      <OptionDropdown
                        label={r.base === 'map' ? 'Map key type' : 'Element type'}
                        value={r.elem}
                        options={ELEM_OPTIONS}
                        onChange={(elem) => update(i, { elem })}
                        buttonClassName="w-28"
                      />
                      {r.base === 'map' && (
                        <OptionDropdown
                          label="Map value type"
                          value={r.value}
                          options={ELEM_OPTIONS}
                          onChange={(value) => update(i, { value })}
                          buttonClassName="w-28"
                        />
                      )}
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={r.frozen}
                          onChange={(e) => update(i, { frozen: e.target.checked })}
                        />
                        frozen
                      </label>
                    </>
                  )}
                  {r.kind === 'clustering' && (
                    <OptionDropdown
                      label="Clustering order"
                      value={r.order}
                      options={ORDER_OPTIONS}
                      onChange={(order) => update(i, { order })}
                      buttonClassName="w-20"
                      listClassName="w-40"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                    disabled={rows.length === 1}
                    aria-label="Remove column"
                    className="text-slate-400 hover:text-red-600 disabled:opacity-40"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, newRow()])}
              className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
            >
              <FontAwesomeIcon icon={faPlus} /> Add column
            </button>
          </div>

          <details className="rounded border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">
              Table options
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-600">Comment</label>
                <input className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Default TTL (seconds)</label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                  placeholder="0 (never expire)"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">GC grace (seconds)</label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={gcGrace}
                  onChange={(e) => setGcGrace(e.target.value)}
                  placeholder="864000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Compaction</label>
                <OptionDropdown
                  label="Compaction"
                  value={compaction}
                  options={COMPACTION_OPTIONS}
                  onChange={setCompaction}
                  buttonClassName="w-full px-3 py-2"
                  listClassName="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Compression</label>
                <OptionDropdown
                  label="Compression"
                  value={compression}
                  options={COMPRESSION_OPTIONS}
                  onChange={setCompression}
                  buttonClassName="w-full px-3 py-2"
                  listClassName="w-full"
                />
              </div>
            </div>
          </details>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              CQL preview
            </label>
            {validationError ? (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {validationError}
              </p>
            ) : (
              <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">
                {preview}
              </pre>
            )}
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
            disabled={!!validationError || !keyspace || mutation.isPending}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
