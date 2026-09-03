import { useQuery } from '@tanstack/react-query';
import { getSchema } from '../../api/schema.js';
import { getMetadata } from '../../api/metadata.js';
import { useCqlDraft } from '../../state/cqlDraft.js';
import { buildInsertCql } from '../../utils/cqlLiteral.js';
import { DynamicForm } from './DynamicForm.js';
import { useState } from 'react';

interface Props {
  keyspace: string;
  table: string;
  /** Optional cancel handler (e.g. switch back to the Data Browser tab). */
  onCancel?: () => void;
}

/**
 * Schema-driven INSERT form. Loads the table schema, renders a
 * `DynamicForm` in insert mode, and — instead of inserting directly —
 * generates the equivalent `INSERT` statement and pushes it into the CQL
 * editor so the user can review/edit it before running it themselves.
 */
export function InsertForm(props: Props) {
  const { keyspace, table, onCancel } = props;
  const pushQuery = useCqlDraft((s) => s.pushQuery);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

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
      {infoMessage && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {infoMessage}
        </div>
      )}
      <DynamicForm
        schema={schema}
        mode="insert"
        metadata={metadataQuery.data}
        submitLabel="Generate CQL"
        onCancel={onCancel}
        onSubmit={(values) => {
          const cql = buildInsertCql(schema.keyspace, schema.table_name, schema.columns, values);
          pushQuery(cql);
          setInfoMessage('INSERT statement sent to the CQL editor below — review and execute it there.');
        }}
      />
    </div>
  );
}
