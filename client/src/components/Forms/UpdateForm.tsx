import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ColumnMetadata, Row, TableSchema } from '@kassandra/shared';
import { rootCqlType } from '@kassandra/shared';
import { getSchema } from '../../api/schema.js';
import { getMetadata } from '../../api/metadata.js';
import { useQueryClient } from '@tanstack/react-query';
import { updateRow } from '../../api/data.js';
import { primaryKeysOf } from '../../utils/primaryKeys.js';
import { DynamicForm, type UpdateDiff } from './DynamicForm.js';

interface Props {
  keyspace: string;
  table: string;
  /** Existing row values; primary-key fields are required and disabled. */
  initial: Row;
  /** Called with the updated row's primary-key values once the update succeeds. */
  onSuccess?: (keys: Row) => void;
  /** Optional cancel handler (shows the cancel button when provided). */
  onCancel?: () => void;
  /** Column metadata, when already fetched by a caller (e.g. RowDetail). */
  metadata?: Record<string, ColumnMetadata>;
}

function splitKeysAndScalarUpdates(
  schema: TableSchema,
  values: Record<string, string>,
  initial: Row,
  changedColumns: Set<string>,
): { keys: Row; scalarUpdates: Row } {
  const keys: Row = {};
  const scalarUpdates: Row = {};
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
    } else if (rootCqlType(col.cql_type) !== 'map' && changedColumns.has(col.name)) {
      const v = values[col.name];
      // A cleared field unsets the column.
      if (v !== undefined) scalarUpdates[col.name] = v === '' ? null : v;
    }
  }
  return { keys, scalarUpdates };
}

/**
 * Schema-driven UPDATE form. Used by RowDetail. Primary-key fields are
 * rendered disabled; only changed columns are sent, and the update is
 * applied directly (prepared statement on the server).
 */
export function UpdateForm(props: Props) {
  const { keyspace, table, initial, onSuccess, onCancel, metadata } = props;
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const schemaQuery = useQuery({
    queryKey: ['schema', keyspace, table],
    queryFn: () => getSchema(keyspace, table),
  });

  const metadataQuery = useQuery({
    queryKey: ['metadata', keyspace, table],
    queryFn: () => getMetadata(keyspace, table),
    enabled: metadata === undefined,
  });

  const effectiveMetadata = metadata ?? metadataQuery.data;

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
      {errorMessage && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      <DynamicForm
        schema={schema}
        mode="update"
        initial={initial}
        metadata={effectiveMetadata}
        submitting={submitting}
        onSubmit={async (values, diff: UpdateDiff | undefined) => {
          setErrorMessage(null);
          if (!diff || diff.changedColumns.size === 0) {
            setErrorMessage('No columns changed.');
            return;
          }
          const { keys, scalarUpdates } = splitKeysAndScalarUpdates(
            schema,
            values,
            initial,
            diff.changedColumns,
          );
          setSubmitting(true);
          try {
            const result = await updateRow(
              keyspace,
              table,
              keys,
              scalarUpdates,
              diff.mapDiffs,
            );
            await queryClient.invalidateQueries({ queryKey: ['data', keyspace, table] });
            onSuccess?.(primaryKeysOf(schema, result.success ? result.rows[0] : undefined));
          } finally {
            setSubmitting(false);
          }
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
