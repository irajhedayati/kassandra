import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSchema } from '../../api/schema.js';
import { insertRow } from '../../api/data.js';
import type { Row } from '@kassandra/shared';
import { DynamicForm } from './DynamicForm.js';
import { useState } from 'react';

interface Props {
  keyspace: string;
  table: string;
}

/**
 * Schema-driven INSERT form. Loads the table schema, renders a
 * `DynamicForm` in insert mode, and POSTs to
 * `/api/data/:ks/:t/rows/insert` on submit.
 */
export function InsertForm(props: Props) {
  const { keyspace, table } = props;
  const queryClient = useQueryClient();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const schemaQuery = useQuery({
    queryKey: ['schema', keyspace, table],
    queryFn: () => getSchema(keyspace, table),
  });

  const mutation = useMutation({
    mutationFn: (values: Row) => insertRow(keyspace, table, values),
    onSuccess: () => {
      setSuccessMessage('Record inserted.');
      setErrorMessage(null);
      void queryClient.invalidateQueries({
        queryKey: ['data', keyspace, table],
      });
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

  return (
    <div className="max-w-4xl space-y-3">
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
        schema={schemaQuery.data}
        mode="insert"
        submitting={mutation.isPending}
        onSubmit={async (values) => {
          setSuccessMessage(null);
          setErrorMessage(null);
          // Strip empty strings — the server interprets "missing" as
          // "do not bind". Empty UUID fields are then auto-generated.
          const payload: Row = {};
          for (const [k, v] of Object.entries(values)) {
            if (v === '') continue;
            payload[k] = v;
          }
          await mutation.mutateAsync(payload);
        }}
      />
    </div>
  );
}
