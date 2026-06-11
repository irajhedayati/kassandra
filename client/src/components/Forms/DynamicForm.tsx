import { useMemo, useState, type FormEvent } from 'react';
import {
  getTypeInfo,
  rootCqlType,
  type ColumnInfo,
  type Row,
  type TableSchema,
} from '@py-sandra/shared';
import { formatValueForEdit } from '../../utils/format.js';
import {
  BlobHexField,
  CheckboxField,
  DateField,
  DatetimeField,
  DurationField,
  InetField,
  JsonField,
  ListField,
  MapField,
  NumberField,
  TextField,
  TimeField,
  UuidField,
  type FieldProps,
} from './fields/index.js';

export type FormMode = 'insert' | 'update';

export interface DynamicFormProps {
  schema: TableSchema;
  mode: FormMode;
  /** Initial values keyed by column name. Used by the update form. */
  initial?: Row | undefined;
  /**
   * Submission handler. Values are the form's string-keyed state — collection
   * fields hold JSON strings (the caller / server is responsible for parsing).
   */
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  /** Optional submit-button label override. */
  submitLabel?: string;
  /** When true, the submit button shows a "submitting" state. */
  submitting?: boolean;
}

function isPrimaryKey(column: ColumnInfo): boolean {
  return column.kind === 'partition_key' || column.kind === 'clustering';
}

function sortColumns(columns: ColumnInfo[]): ColumnInfo[] {
  // Mirrors legacy TableSchema.all_columns_sorted: partition keys (by
  // position), then clustering keys (by position), then everything else
  // in declaration order.
  const partition = columns
    .filter((c) => c.kind === 'partition_key')
    .slice()
    .sort((a, b) => a.position - b.position);
  const clustering = columns
    .filter((c) => c.kind === 'clustering')
    .slice()
    .sort((a, b) => a.position - b.position);
  const regular = columns.filter(
    (c) => c.kind !== 'partition_key' && c.kind !== 'clustering',
  );
  return [...partition, ...clustering, ...regular];
}

function pickFieldComponent(cqlType: string) {
  const widget = getTypeInfo(cqlType).widget;
  switch (widget) {
    case 'text':
    case 'textarea':
      return TextField;
    case 'number_int':
    case 'number_float':
      return NumberField;
    case 'checkbox':
      return CheckboxField;
    case 'date':
      return DateField;
    case 'time':
      return TimeField;
    case 'datetime':
      return DatetimeField;
    case 'uuid':
      return UuidField;
    case 'json':
      return JsonField;
    case 'list':
    case 'set':
      return ListField;
    case 'map':
      return MapField;
    case 'blob_hex':
      return BlobHexField;
    case 'inet':
      return InetField;
    case 'duration':
      return DurationField;
    default: {
      // exhaustiveness fallback
      const _never: never = widget;
      void _never;
      return TextField;
    }
  }
}

function initialStringValue(column: ColumnInfo, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  const root = rootCqlType(column.cql_type);
  if (root === 'boolean') {
    return raw === true || raw === 'true' || raw === 1 || raw === '1'
      ? 'true'
      : 'false';
  }
  if (root === 'timestamp') {
    if (raw instanceof Date) return raw.toISOString().slice(0, 19);
    if (typeof raw === 'number')
      return new Date(raw).toISOString().slice(0, 19);
    if (typeof raw === 'string') {
      // Accept ISO with or without trailing Z; trim millis/Z so the
      // datetime-local widget accepts it.
      const trimmed = raw.replace('Z', '').slice(0, 19);
      return trimmed;
    }
    return String(raw);
  }
  return formatValueForEdit(raw, column.cql_type);
}

function validateCollectionsJson(
  schema: TableSchema,
  values: Record<string, string>,
): string | null {
  for (const col of schema.columns) {
    const root = rootCqlType(col.cql_type);
    if (root !== 'list' && root !== 'set' && root !== 'map' && root !== 'tuple')
      continue;
    const v = values[col.name];
    if (!v || !v.trim()) continue;
    try {
      JSON.parse(v);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Invalid JSON in "${col.name}": ${msg}`;
    }
  }
  return null;
}

/**
 * Schema-driven form generator. Mirrors legacy
 * `src/ui/dynamic_form.py:render_dynamic_form` semantics:
 *
 *  - Renders one widget per column in primary-key-first order.
 *  - In update mode, primary-key fields are disabled.
 *  - Collection fields are edited as JSON text and validated on submit.
 */
export function DynamicForm(props: DynamicFormProps) {
  const { schema, mode, initial, onSubmit, submitLabel, submitting } = props;

  const ordered = useMemo(() => sortColumns(schema.columns), [schema.columns]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const col of ordered) {
      seed[col.name] = initialStringValue(col, initial?.[col.name]);
    }
    return seed;
  });
  const [error, setError] = useState<string | null>(null);

  function setValue(name: string, next: string) {
    setValues((prev) => ({ ...prev, [name]: next }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const collectionError = validateCollectionsJson(schema, values);
    if (collectionError) {
      setError(collectionError);
      return;
    }
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const defaultLabel = mode === 'insert' ? 'Insert Record' : 'Update Record';

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <h2 className="text-base font-semibold text-slate-800">
        {mode === 'insert' ? 'Insert' : 'Update'} record:{' '}
        <span className="font-mono text-slate-600">
          {schema.keyspace}.{schema.table_name}
        </span>
      </h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ordered.map((column) => {
          const Component = pickFieldComponent(column.cql_type);
          const placeholder = getTypeInfo(column.cql_type).placeholder;
          const disabled = mode === 'update' && isPrimaryKey(column);
          const fieldProps: FieldProps = {
            column,
            value: values[column.name] ?? '',
            onChange: (v) => setValue(column.name, v),
            disabled,
            ...(placeholder !== undefined ? { placeholder } : {}),
          };
          return <Component key={column.name} {...fieldProps} />;
        })}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-blue-400"
        >
          {submitting ? 'Submitting…' : (submitLabel ?? defaultLabel)}
        </button>
      </div>
    </form>
  );
}
