/**
 * Paginated data grid for a Cassandra table.
 *
 * Features (matches lane-C contract):
 *   - Page-size selector [10, 25, 50] driving fetchSize.
 *   - Cassandra forward-only paging: Next page → push current paging state
 *     onto a stack; Reset → clear the stack and re-fetch from page 1.
 *   - Filters: equality on any column, submitted on Enter; map columns get
 *     extra operators (map[key] = value, CONTAINS, CONTAINS KEY).
 *   - Row click → RowDetail drawer with Edit / Delete.
 *   - Map columns marked `display_type === 'JSON'` (per Lane F metadata)
 *     render as a formatted <pre> block in the cell.
 *   - Hidden columns (per Lane F metadata) are excluded from the grid.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { flexRender } from '@tanstack/react-table';
import {
  useLegacyTable,
  getCoreRowModel,
  type LegacyColumnDef,
} from '@tanstack/react-table/legacy';
import type {
  ColumnInfo,
  ColumnMetadata,
  CqlValue,
  FilterCondition,
  FilterOperator,
  MapSchemaEntry,
  QueryResult,
  Row,
} from '@kassandra/shared';
import { rootCqlType } from '@kassandra/shared';
import { readRows } from '../../api/data.js';
import { getSchema } from '../../api/schema.js';
import { getMetadata } from '../../api/metadata.js';
import { ApiError } from '../../api/client.js';
import { PaginationBar } from './PaginationBar.js';
import { RowDetail } from './RowDetail.js';
import { OptionDropdown } from '../OptionDropdown.js';

interface Props {
  keyspace: string;
  table: string;
}

const PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 25;

interface FilterDraftEntry {
  operator: FilterOperator;
  mapKey?: string;
  value: string;
}

function defaultOperatorFor(col: ColumnInfo): FilterOperator {
  return rootCqlType(col.cql_type) === 'map' ? 'map_entry_eq' : 'eq';
}

export function DataGrid({ keyspace, table }: Props) {
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [pageStack, setPageStack] = useState<(string | null)[]>([null]);
  const [filterDraft, setFilterDraft] = useState<Record<string, FilterDraftEntry>>({});
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);

  const currentPagingState = pageStack[pageStack.length - 1] ?? null;

  // Reset paging when ks/table/page-size/filters change.
  useEffect(() => {
    setPageStack([null]);
    setSelectedRow(null);
  }, [keyspace, table, pageSize, filters]);

  // Reset filter inputs when switching tables.
  useEffect(() => {
    setFilterDraft({});
    setFilters([]);
  }, [keyspace, table]);

  const schemaQuery = useQuery({
    queryKey: ['schema', keyspace, table],
    queryFn: () => getSchema(keyspace, table),
  });

  const metadataQuery = useQuery({
    queryKey: ['metadata', keyspace, table],
    queryFn: () => getMetadata(keyspace, table),
  });

  const dataQuery = useQuery<QueryResult, Error>({
    queryKey: [
      'data',
      keyspace,
      table,
      pageSize,
      filters,
      currentPagingState ?? '__first__',
    ],
    queryFn: async () => {
      const result = await readRows(keyspace, table, {
        pageSize,
        pagingState: currentPagingState,
        filters,
      });
      // unwrap already throws on success=false; cast for the type system.
      return result as QueryResult;
    },
    enabled: schemaQuery.isSuccess,
  });

  const schema = schemaQuery.data;
  const metadata = metadataQuery.data ?? {};

  const visibleColumns = useMemo<ColumnInfo[]>(() => {
    if (!schema) return [];
    return schema.columns.filter((c) => !metadata[c.name]?.hide);
  }, [schema]);

  // Filterable columns: every column in the table, partition keys first,
  // then everything else, each group sorted by name. Filtering on regular
  // columns triggers ALLOW FILTERING server-side; acceptable here since
  // the user asked for it explicitly.
  const filterColumns = useMemo(() => {
    if (!schema) return [];
    const byName = (a: ColumnInfo, b: ColumnInfo) => a.name.localeCompare(b.name);
    const partition = schema.columns.filter((c) => c.kind === 'partition_key').slice().sort(byName);
    const rest = schema.columns.filter((c) => c.kind !== 'partition_key').slice().sort(byName);
    return [...partition, ...rest];
  }, [schema]);

  const tableColumns = useMemo<LegacyColumnDef<Row>[]>(() => {
    return visibleColumns.map((col) => ({
      id: col.name,
      accessorKey: col.name,
      header: () => (
        <span title={`${col.name} : ${col.cql_type}`}>
          {col.name}
          <span className="ml-1 text-xs font-normal text-slate-400">
            {col.kind === 'partition_key'
              ? '(pk)'
              : col.kind === 'clustering'
                ? '(ck)'
                : ''}
          </span>
        </span>
      ),
      cell: ({ getValue }) => renderCell(col, getValue() as CqlValue, metadata[col.name]),
    }));
  }, [visibleColumns]);

  const rows = dataQuery.data?.rows ?? [];

  const tableInstance = useLegacyTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const onApplyFilters = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: FilterCondition[] = [];
    for (const [column, draft] of Object.entries(filterDraft)) {
      if (draft.value.trim() === '') continue;
      if (draft.operator === 'map_entry_eq' && (draft.mapKey ?? '').trim() === '') continue;
      next.push({
        column,
        operator: draft.operator,
        value: draft.value,
        ...(draft.operator === 'map_entry_eq' ? { mapKey: draft.mapKey } : {}),
      });
    }
    setFilters(next);
  };

  const onClearFilters = () => {
    setFilterDraft({});
    setFilters([]);
  };

  const onNext = () => {
    const next = dataQuery.data?.pagingState ?? null;
    if (!next) return;
    setPageStack((s) => [...s, next]);
    setSelectedRow(null);
  };

  const onReset = () => {
    setPageStack([null]);
    setSelectedRow(null);
  };

  if (schemaQuery.isLoading) {
    return <div className="text-sm text-slate-500">Loading schema…</div>;
  }
  if (schemaQuery.isError) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
        Failed to load schema: {(schemaQuery.error as Error).message}
      </div>
    );
  }
  if (!schema) {
    return <div className="text-sm text-slate-500">No schema available.</div>;
  }

  const errorMessage =
    dataQuery.error instanceof ApiError
      ? dataQuery.error.message
      : dataQuery.error
        ? (dataQuery.error as Error).message
        : null;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {keyspace}.{table}
          </h2>
          <p className="text-xs text-slate-500">
            {schema.columns.length} column{schema.columns.length === 1 ? '' : 's'}
            {filters.length > 0
              ? ` • ${filters.length} filter${filters.length === 1 ? '' : 's'} applied`
              : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void schemaQuery.refetch();
            void metadataQuery.refetch();
            void dataQuery.refetch();
          }}
          disabled={dataQuery.isFetching}
          className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Reload rows for the current page and filters"
        >
          <span className={dataQuery.isFetching ? 'inline-block animate-spin' : 'inline-block'}>⟳</span>
          Refresh
        </button>
      </header>

      {filterColumns.length > 0 && (
        <form
          onSubmit={onApplyFilters}
          className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3"
        >
          {filterColumns.map((col) => {
            const isMap = rootCqlType(col.cql_type) === 'map';
            const draft = filterDraft[col.name] ?? {
              operator: defaultOperatorFor(col),
              value: '',
            };
            const setDraft = (patch: Partial<FilterDraftEntry>) =>
              setFilterDraft((d) => ({
                ...d,
                [col.name]: { ...draft, ...patch },
              }));

            return (
              <div key={col.name} className="flex flex-col">
                <label className="text-xs text-slate-600" htmlFor={`filter-${col.name}`}>
                  {col.name}
                  {(col.kind === 'partition_key' || col.kind === 'clustering') && (
                    <span className="ml-1 text-slate-400">
                      {col.kind === 'partition_key' ? '(pk)' : '(ck)'}
                    </span>
                  )}
                </label>

                {isMap && (
                  <FilterOperatorDropdown
                    label={`${col.name} filter operator`}
                    value={draft.operator}
                    onChange={(op) => setDraft({ operator: op })}
                  />
                )}

                <div className="flex gap-1">
                  {isMap && draft.operator === 'map_entry_eq' && (
                    <MapKeyCombobox
                      value={draft.mapKey ?? ''}
                      onChange={(v) => setDraft({ mapKey: v })}
                      options={metadata[col.name]?.map_schema ?? []}
                    />
                  )}
                  <input
                    id={`filter-${col.name}`}
                    type="text"
                    value={draft.value}
                    onChange={(e) => setDraft({ value: e.target.value })}
                    placeholder={
                      isMap
                        ? draft.operator === 'contains_key'
                          ? 'key'
                          : draft.operator === 'map_entry_eq'
                            ? 'value'
                            : 'value it contains'
                        : `Filter by ${col.name}…`
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              </div>
            );
          })}
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded border border-blue-600 bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
            >
              Clear
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              {tableInstance.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-medium"
                    >
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {dataQuery.isLoading || dataQuery.isFetching ? (
                <tr>
                  <td
                    colSpan={Math.max(visibleColumns.length, 1)}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : errorMessage ? (
                <tr>
                  <td
                    colSpan={Math.max(visibleColumns.length, 1)}
                    className="px-3 py-6 text-center text-red-700"
                  >
                    {errorMessage}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(visibleColumns.length, 1)}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No rows.
                  </td>
                </tr>
              ) : (
                tableInstance.getRowModel().rows.map((tr) => (
                  <tr
                    key={tr.id}
                    onClick={() => setSelectedRow(tr.original)}
                    className="cursor-pointer border-b border-slate-100 hover:bg-blue-50"
                  >
                    {tr.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="max-w-md truncate px-3 py-2 align-top text-slate-800"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationBar
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          onPageSizeChange={setPageSize}
          hasMorePages={!!dataQuery.data?.hasMorePages}
          canReset={pageStack.length > 1}
          onNext={onNext}
          onReset={onReset}
          loading={dataQuery.isFetching}
          rowCount={rows.length}
        />
      </div>

      <RowDetail
        open={selectedRow !== null}
        keyspace={keyspace}
        table={table}
        schema={schema}
        row={selectedRow}
        metadata={metadata}
        onClose={() => setSelectedRow(null)}
      />
    </div>
  );
}

/**
 * Map filter operator choices, each with a Flowbite-style helper-text row
 * (bold label + description) describing what the operator matches.
 */
const MAP_FILTER_OPERATORS: { value: FilterOperator; label: string; helperText: string }[] = [
  { value: 'map_entry_eq', label: 'Key = value', helperText: "Match a specific key's value" },
  { value: 'contains_key', label: 'Contains key', helperText: 'Map includes this key, any value' },
  { value: 'contains', label: 'Contains value', helperText: 'Map includes this value, any key' },
];

function FilterOperatorDropdown({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FilterOperator;
  onChange: (op: FilterOperator) => void;
}) {
  return (
    <div className="mb-1">
      <OptionDropdown
        label={label}
        value={value}
        options={MAP_FILTER_OPERATORS}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Free-text input for a map key, with a wide dropdown (independent of the
 * input's own width) suggesting keys from the column's map schema. Users
 * can still type any key, including ones not in the suggested list.
 */
function MapKeyCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: MapSchemaEntry[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const needle = value.trim().toLowerCase();
  const filtered = needle
    ? options.filter(
        (o) => o.key.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle),
      )
    : options;

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="key"
        className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute left-0 top-full z-10 mt-1 max-h-60 w-64 overflow-auto rounded border border-slate-300 bg-white text-sm shadow-lg">
          {filtered.map((o) => (
            <li
              key={o.key}
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
              className="cursor-pointer px-2 py-1 hover:bg-blue-50"
            >
              {o.label}
              {o.label !== o.key && <span className="ml-1 text-xs text-slate-400">({o.key})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function renderCell(
  col: ColumnInfo,
  value: CqlValue,
  metadata: ColumnMetadata | undefined,
): ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-slate-400">null</span>;
  }
  const root = rootCqlType(col.cql_type);
  const isMap = root === 'map';
  const displayJson = metadata?.display_type === 'JSON';

  if (isMap && displayJson) {
    return (
      <pre className="m-0 whitespace-pre-wrap break-words text-xs text-slate-700">
        {safeStringify(value)}
      </pre>
    );
  }

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return safeStringify(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
