import { useQuery } from '@tanstack/react-query';
import { getSchema } from '../../api/schema.js';
import { getMetadata } from '../../api/metadata.js';
import { useQueryClient } from '@tanstack/react-query';
import { insertRow } from '../../api/data.js';
import { primaryKeysOf } from '../../utils/primaryKeys.js';
import type { Row } from '@kassandra/shared';
import { DynamicForm } from './DynamicForm.js';
import { useState } from 'react';

interface Props {
  keyspace: string;
  table: string;
  /** Optional cancel handler (e.g. switch back to the Data Browser tab). */
  onCancel?: () => void;
  /** Called with the stored row's primary-key values once the insert succeeds. */
  onSaved?: (keys: Row) => void;
}

/**
 * Schema-driven INSERT form. Loads the table schema, renders a
 * `DynamicForm` in insert mode, and inserts the row directly (prepared
 * statement on the server). On success the caller is told which record
 * was written so it can show it in the Data Browser.
 */
export function InsertForm(props: Props) {
  const { keyspace, table, onCancel, onSaved } = props;
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const schemaQuery = useQuery({
    queryKey: ['schema', keyspace, table],
    queryFn: () => getSchema(keyspace, table),
  });

  const metadataQuery = useQuery({
    queryKey: ['metadata', keyspace, table],
    queryFn: () => getMetadata(keyspace, table),
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
    <div className="max-w-4xl space-y-3">
      <DynamicForm
        schema={schema}
        mode="insert"
        metadata={metadataQuery.data}
        submitting={submitting}
        onCancel={onCancel}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            const result = await insertRow(keyspace, table, values);
            await queryClient.invalidateQueries({ queryKey: ['data', keyspace, table] });
            onSaved?.(primaryKeysOf(schema, result.success ? result.rows[0] : undefined));
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
