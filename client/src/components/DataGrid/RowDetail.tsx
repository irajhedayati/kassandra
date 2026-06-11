/**
 * Row detail drawer. Shows the row as formatted JSON with Edit / Delete
 * action buttons.
 *
 *   - Edit  → swaps the read-only view for the UpdateForm (Lane D).
 *   - Delete → opens ConfirmDelete; on confirm, calls deleteRow, invalidates
 *              the data query, and closes the drawer.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Row, TableSchema } from '@kassandra/shared';
import { deleteRow } from '../../api/data.js';
import { ApiError } from '../../api/client.js';
import { ConfirmDelete } from '../Dialogs/ConfirmDelete.js';
import { UpdateForm } from '../Forms/UpdateForm.js';

interface Props {
  open: boolean;
  keyspace: string;
  table: string;
  schema: TableSchema;
  row: Row | null;
  onClose: () => void;
}

export function RowDetail(props: Props) {
  const { open, keyspace, table, schema, row, onClose } = props;
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const primaryKeys = useMemo<Row>(() => {
    if (!row) return {};
    const out: Row = {};
    for (const col of schema.columns) {
      if (col.kind === 'partition_key' || col.kind === 'clustering') {
        const v = row[col.name];
        out[col.name] = v ?? null;
      }
    }
    return out;
  }, [row, schema.columns]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteRow(keyspace, table, primaryKeys),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['data', keyspace, table] });
      setConfirming(false);
      setDeleteError(null);
      onClose();
    },
    onError: (err: unknown) => {
      setDeleteError(err instanceof ApiError ? err.message : String(err));
    },
  });

  if (!open || !row) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {mode === 'edit' ? 'Edit row' : 'Row detail'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {mode === 'view' ? (
            <pre className="whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
              {safeStringify(row)}
            </pre>
          ) : (
            <UpdateForm
              keyspace={keyspace}
              table={table}
              initial={row}
              onSuccess={async () => {
                await queryClient.invalidateQueries({ queryKey: ['data', keyspace, table] });
                setMode('view');
                onClose();
              }}
              onCancel={() => setMode('view')}
            />
          )}
        </div>

        {mode === 'view' && (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3">
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirming(true);
              }}
              className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setMode('edit')}
              className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Edit
            </button>
          </footer>
        )}
      </aside>

      <ConfirmDelete
        open={confirming}
        keys={primaryKeys}
        loading={deleteMutation.isPending}
        errorMessage={deleteError}
        onCancel={() => {
          setConfirming(false);
          setDeleteError(null);
        }}
        onConfirm={() => {
          setDeleteError(null);
          deleteMutation.mutate();
        }}
      />
    </>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
