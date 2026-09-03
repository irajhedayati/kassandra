import {type FormEvent, useMemo, useRef, useState} from 'react';
import {
    type ColumnInfo,
    type ColumnMetadata,
    getTypeInfo,
    rootCqlType,
    type Row,
    type TableSchema,
} from '@kassandra/shared';
import {formatValueForEdit} from '../../utils/format.js';
import {
    BlobHexField,
    CheckboxField,
    CopyButton,
    DateField,
    DatetimeField,
    DurationField,
    EnumField,
    type FieldProps,
    InetField,
    JsonField,
    JsonHighlightField,
    ListField,
    MapField,
    NumberField,
    TextField,
    TimeField,
    UuidField,
} from './fields';

const TEXT_ROOT_TYPES = new Set(['text', 'varchar', 'ascii']);

function isJsonTextColumn(
    column: ColumnInfo,
    metadata: Record<string, ColumnMetadata> | undefined,
): boolean {
    if (!TEXT_ROOT_TYPES.has(rootCqlType(column.cql_type))) return false;
    return metadata?.[column.name]?.display_type === 'JSON';
}

function enumValuesFor(
    column: ColumnInfo,
    metadata: Record<string, ColumnMetadata> | undefined,
): string[] | null {
    if (!TEXT_ROOT_TYPES.has(rootCqlType(column.cql_type))) return null;
    const meta = metadata?.[column.name];
    if (meta?.display_type !== 'enum') return null;
    return meta.enum_values ?? [];
}

export type FormMode = 'insert' | 'update';

export interface MapFieldDiff {
    /** Keys that were added or whose value changed, ready to merge in via `col + {...}`. */
    set: Record<string, string>;
    /** Keys present in the original map but removed by the user. */
    deleted: string[];
}

export interface UpdateDiff {
    /** Names of columns whose value actually changed (map columns included only if their diff is non-empty). */
    changedColumns: Set<string>;
    /** Per-key diff for `map` columns, keyed by column name. */
    mapDiffs: Record<string, MapFieldDiff>;
}

export interface DynamicFormProps {
    schema: TableSchema;
    mode: FormMode;
    /** Initial values keyed by column name. Used by the update form. */
    initial?: Row | undefined;
    /**
     * Submission handler. Values are the form's string-keyed state — collection
     * fields hold JSON strings (the caller / server is responsible for parsing).
     * In update mode, `diff` reports exactly what changed since `initial`, so
     * the caller can generate a minimal UPDATE (and, for map columns, only
     * touch the added/updated/removed entries).
     */
    onSubmit: (values: Record<string, string>, diff?: UpdateDiff) => Promise<void> | void;
    /** Optional submit-button label override. */
    submitLabel?: string;
    /** When true, the submit button shows a "submitting" state. */
    submitting?: boolean;
    /** When true, every field is disabled and the submit button is hidden. */
    readOnly?: boolean;
    /** Column metadata (display_type, hide, map_schema) keyed by column name. */
    metadata?: Record<string, ColumnMetadata>;
    /** Optional cancel handler; shows a Cancel button next to Submit when provided. */
    onCancel?: () => void;
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
            void widget;
            return TextField;
        }
    }
}

function initialStringValue(column: ColumnInfo, raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    const root = rootCqlType(column.cql_type);
    if (root === 'boolean') {
        return raw === true || raw === 'true' || raw === 1 || raw === '1' ? 'true' : 'false';
    }
    if (root === 'timestamp') {
        if (raw instanceof Date) return raw.toISOString().slice(0, 19);
        if (typeof raw === 'number')
            return new Date(raw).toISOString().slice(0, 19);
        if (typeof raw === 'string') {
            // Accept ISO with or without trailing Z; trim millis/Z so the
            // datetime-local widget accepts it.
            return raw.replace('Z', '').slice(0, 19);
        }
        return String(raw);
    }
    return formatValueForEdit(raw, column.cql_type);
}

function validateCollectionsJson(schema: TableSchema, values: Record<string, string>,): string | null {
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

function parseMapObject(raw: string): Record<string, string> {
    if (!raw || !raw.trim()) return {};
    try {
        const obj: unknown = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
                out[k] = String(v ?? '');
            }
            return out;
        }
    } catch {
        // unparsable — treat as empty; validateCollectionsJson already
        // surfaces a proper error to the user before this ever runs.
    }
    return {};
}

/** Diff two map<K,V> columns (serialized as JSON objects) key by key. */
function diffMapValue(oldRaw: string, newRaw: string): MapFieldDiff {
    const oldMap = parseMapObject(oldRaw);
    const newMap = parseMapObject(newRaw);
    const set: Record<string, string> = {};
    for (const [k, v] of Object.entries(newMap)) {
        if (oldMap[k] === undefined || oldMap[k] !== v) set[k] = v;
    }
    const deleted = Object.keys(oldMap).filter((k) => !(k in newMap));
    return {set, deleted};
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
    const {schema, mode, initial, onSubmit, submitLabel, submitting, readOnly, metadata, onCancel} = props;

    const ordered = useMemo(() => sortColumns(schema.columns), [schema.columns]);

    const [values, setValues] = useState<Record<string, string>>(() => {
        const seed: Record<string, string> = {};
        for (const col of ordered) {
            seed[col.name] = initialStringValue(col, initial?.[col.name]);
        }
        return seed;
    });
    // Snapshot of the seed values, used to diff against on submit in update
    // mode. `values` is never mutated in place (setValue always spreads into
    // a new object), so this ref keeps pointing at the original values.
    const initialSeedRef = useRef(values);
    const [error, setError] = useState<string | null>(null);

    function setValue(name: string, next: string) {
        setValues((prev) => ({...prev, [name]: next}));
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);
        const collectionError = validateCollectionsJson(schema, values);
        if (collectionError) {
            setError(collectionError);
            return;
        }

        let diff: UpdateDiff | undefined;
        if (mode === 'update') {
            const changedColumns = new Set<string>();
            const mapDiffs: Record<string, MapFieldDiff> = {};
            for (const column of ordered) {
                if (isPrimaryKey(column)) continue;
                const oldVal = initialSeedRef.current[column.name] ?? '';
                const newVal = values[column.name] ?? '';
                if (rootCqlType(column.cql_type) === 'map') {
                    const d = diffMapValue(oldVal, newVal);
                    if (Object.keys(d.set).length > 0 || d.deleted.length > 0) {
                        changedColumns.add(column.name);
                        mapDiffs[column.name] = d;
                    }
                } else if (oldVal !== newVal) {
                    changedColumns.add(column.name);
                }
            }
            diff = {changedColumns, mapDiffs};
        }

        try {
            await onSubmit(values, diff);
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

            <div
                className="grid max-w-[960px] gap-4 2xl:max-w-none"
                style={{gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))'}}
            >
                {ordered.map((column) => {
                    const enumValues = enumValuesFor(column, metadata);
                    const placeholder = getTypeInfo(column.cql_type).placeholder;
                    const disabled = readOnly || (mode === 'update' && isPrimaryKey(column));
                    const fieldValue = values[column.name] ?? '';
                    const fieldProps: FieldProps = {
                        column,
                        value: fieldValue,
                        onChange: (v) => setValue(column.name, v),
                        disabled,
                        ...(placeholder !== undefined ? {placeholder} : {}),
                    };
                    let field: React.ReactNode;
                    if (enumValues) {
                        field = <EnumField {...fieldProps} enumValues={enumValues} />;
                    } else {
                        const Component = isJsonTextColumn(column, metadata)
                            ? JsonHighlightField
                            : pickFieldComponent(column.cql_type);
                        field = <Component {...fieldProps} />;
                    }
                    return (
                        <div key={column.name} className="relative">
                            {field}
                            <div className="absolute right-0 top-0">
                                <CopyButton value={fieldValue} label={column.name}/>
                            </div>
                        </div>
                    );
                })}
            </div>

            {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                </div>
            )}

            {!readOnly && (
                <div className="flex justify-end gap-2">
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={submitting}
                            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={submitting}
                        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-blue-400"
                    >
                        {submitting ? 'Submitting…' : (submitLabel ?? defaultLabel)}
                    </button>
                </div>
            )}
        </form>
    );
}
