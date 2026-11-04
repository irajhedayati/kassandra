/**
 * Pick a per-table metadata file from the config directory and import it as
 * the metadata of the current table. Asks for confirmation before replacing
 * metadata that already exists.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TableMetadataFile } from '@kassandra/shared';
import { listMetadataFiles } from '../../api/metadata.js';

interface Props {
  open: boolean;
  keyspace: string;
  table: string;
  /** Importing would replace metadata (saved, or unsaved edits on the page). */
  willOverwrite: boolean;
  loading: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onImport: (file: string) => void;
}

export function ImportSchemaDialog(props: Props) {
  const { open, keyspace, table } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const filesQuery = useQuery<TableMetadataFile[]>({
    queryKey: ['metadata-files'],
    queryFn: listMetadataFiles,
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open) {
      setSelected(null);
      setConfirming(false);
    }
  }, [open]);

  // Files for this very table come first.
  const files = useMemo(() => {
    const matches = (f: TableMetadataFile) => f.keyspace === keyspace && f.table === table;
    return [...(filesQuery.data ?? [])].sort(
      (a, b) => Number(matches(b)) - Number(matches(a)) || a.file.localeCompare(b.file),
    );
  }, [filesQuery.data, keyspace, table]);

  if (!open) return null;

  const handleImport = () => {
    if (!selected) return;
    if (props.willOverwrite && !confirming) {
      setConfirming(true);
      return;
    }
    props.onImport(selected);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-2xl rounded bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Import schema</h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose a metadata file from the configuration directory to use for{' '}
          <span className="font-mono">
            {keyspace}.{table}
          </span>
          . Its columns must all exist in this table.
        </p>

        <div className="mt-4 max-h-72 overflow-auto rounded border border-slate-200">
          {filesQuery.isLoading ? (
            <div className="p-3 text-sm text-slate-500">Loading files…</div>
          ) : filesQuery.isError ? (
            <div className="p-3 text-sm text-red-600">
              Failed to list files: {(filesQuery.error as Error).message}
            </div>
          ) : files.length === 0 ? (
            <div className="p-3 text-sm text-slate-500">
              No table metadata files found in the configuration directory.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 font-semibold">Connection</th>
                  <th className="px-3 py-2 font-semibold">Table</th>
                  <th className="px-3 py-2 text-right font-semibold">Columns</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.file}
                    onClick={() => {
                      setSelected(f.file);
                      setConfirming(false);
                    }}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                      selected === f.file ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="radio"
                        name="metadata-file"
                        aria-label={f.file}
                        checked={selected === f.file}
                        onChange={() => {
                          setSelected(f.file);
                          setConfirming(false);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">{f.connection}</td>
                    <td className="px-3 py-2 font-mono">
                      {f.keyspace}.{f.table}
                    </td>
                    <td className="px-3 py-2 text-right">{f.columns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {confirming && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
            This replaces the current metadata for {keyspace}.{table}, including any unsaved
            changes. Continue?
          </div>
        )}

        {props.errorMessage && (
          <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {props.errorMessage}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.loading}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!selected || props.loading}
            className={`rounded border px-3 py-1.5 text-sm text-white disabled:opacity-50 ${
              confirming
                ? 'border-red-600 bg-red-600 hover:bg-red-700'
                : 'border-blue-600 bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {props.loading ? 'Importing…' : confirming ? 'Overwrite' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
