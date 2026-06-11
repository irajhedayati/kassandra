import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Row, TableSchema } from '@py-sandra/shared';
import { getSchema } from '../../api/schema.js';
import { updateRow } from '../../api/data.js';
import { DynamicForm } from './DynamicForm.js';

interface Props {
  keyspace: string;
  table: string;
  /** Existing row values; primary-key fields are required and disabled. */
  initial: Row;
  /** Optional callback fired after a successful update. */
  onSuccess?: () => void;
  /** Optional cancel handler (shows the cancel button when provided). */
  onCancel?: () => void;
}

function splitKeysAndUpdates(
  schema: TableSchema,
  values: Record<string, string>,
  initial: Row,
): { keys: Row; updates: Row } {
  const keys: Row = {};
  const updates: Row = {};
  for (const col of schema.columns) {
    if (col.kind === 'partition_key' || col.kind === 'clustering') {
      // Use the original initial value to avoid relying on string round-trip
      // for typed PK values (uuid, int, etc.).
      const original = initial[col.name];
      if (original !== undefined) {
        keys[col.name] = original;
      } else {
        const v = values[col.name];
        if (v !== undefined && v !== '') keys[col.name] = v;
      }
    } else {
      const v = values[col.name];
      if (v !== undefined && v !== '') updates[col.name] = v;
    }
  }
  return { keys, updates };
}

/**
 * Schema-driven UPDATE form. Used by Lane C's RowDetail. Primary-key
 * fields are rendered disabled; only regular columns are sent to the
 * server's UPDATE endpoint.
 */
export function UpdateForm(props: Props) {
  const { keyspace, table, initial, onSuccess, onCancel } = props;
  const queryClient = useQueryClient();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const schemaQuery = useQuery({
    queryKey: ['schema', keyspace, table],
    queryFn: () => getSchema(keyspace, table),
  });

  const mutation = useMutation({
    mutationFn: ({ keys, updates }: { keys: Row; updates: Row }) =>
      updateRow(keyspace, table, keys, updates),
    onSuccess: () => {
      setSuccessMessage('Record updated.');
      setErrorMessage(null);
      void queryClient.invalidateQueries({
        queryKey: ['data', keyspace, table],
      });
      onSuccess?.();
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setSuccessMessage(null);
    },
  });

  if (schemaQuery.isLoading) {
    return <div className="text-sm text-slate-500">Loading schema…</div>;
  }
  if (schemaQuery.isError || !schemaQuery.data) {
    const msg =
      schemaQuery.error instanceof Error
        ? schemaQuery.error.message
        : 'Failed to load schema.';
    return (
      <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {msg}
      </div>
    );
  }

  const schema = schemaQuery.data;

  return (
    <div className="space-y-3">
      {successMessage && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      <DynamicForm
        schema={schema}
        mode="update"
        initial={initial}
        submitLabel="Update Record"
        submitting={mutation.isPending}
        onSubmit={async (values) => {
          setSuccessMessage(null);
          setErrorMessage(null);
          const { keys, updates } = splitKeysAndUpdates(
            schema,
            values,
            initial,
          );
          if (Object.keys(updates).length === 0) {
            setErrorMessage('No regular columns changed.');
            return;
          }
          await mutation.mutateAsync({ keys, updates });
        }}
      />
      {onCancel && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
