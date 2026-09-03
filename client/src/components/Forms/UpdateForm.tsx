import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ColumnMetadata, Row, TableSchema } from '@kassandra/shared';
import { getSchema } from '../../api/schema.js';
import { getMetadata } from '../../api/metadata.js';
import { useCqlDraft } from '../../state/cqlDraft.js';
import { buildUpdateCql } from '../../utils/cqlLiteral.js';
import { DynamicForm } from './DynamicForm.js';

interface Props {
  keyspace: string;
  table: string;
  /** Existing row values; primary-key fields are required and disabled. */
  initial: Row;
  /** Optional callback fired after the update CQL has been generated. */
  onSuccess?: () => void;
  /** Optional cancel handler (shows the cancel button when provided). */
  onCancel?: () => void;
  /** Column metadata, when already fetched by a caller (e.g. RowDetail). */
  metadata?: Record<string, ColumnMetadata>;
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
 * Schema-driven UPDATE form. Used by RowDetail. Primary-key fields are
 * rendered disabled; instead of updating directly, generates the
 * equivalent `UPDATE` statement and pushes it into the CQL editor so the
 * user can review/edit it before running it themselves.
 */
export function UpdateForm(props: Props) {
  const { keyspace, table, initial, onSuccess, onCancel, metadata } = props;
  const pushQuery = useCqlDraft((s) => s.pushQuery);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

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
      {infoMessage && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {infoMessage}
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
        metadata={effectiveMetadata}
        submitLabel="Generate CQL"
        onSubmit={(values) => {
          setErrorMessage(null);
          setInfoMessage(null);
          const { keys, updates } = splitKeysAndUpdates(schema, values, initial);
          if (Object.keys(updates).length === 0) {
            setErrorMessage('No regular columns changed.');
            return;
          }
          const cql = buildUpdateCql(schema.keyspace, schema.table_name, schema.columns, keys, updates);
          pushQuery(cql);
          setInfoMessage('UPDATE statement sent to the CQL editor below — review and execute it there.');
          onSuccess?.();
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
