/**
 * Table info panel: schema readout (column name, type, key kind, hide,
 * map-schema editor for map columns).
 *
 * Owned by the metadata/info lane.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ColumnInfo,
  ColumnMetadata,
  MapSchemaEntry,
  TableSchema,
} from '@py-sandra/shared';
import { rootCqlType } from '@py-sandra/shared';
import { apiGet } from '../../api/client.js';
import {
  getMetadata,
  setColumnMetadata as apiSetColumnMetadata,
} from '../../api/metadata.js';
import { MapSchemaEditor } from '../Dialogs/MapSchemaEditor.js';

interface Props {
  keyspace: string;
  table: string;
}

interface MapEditorTarget {
  column: string;
  current: MapSchemaEntry[];
}

function keyKindLabel(col: ColumnInfo): string {
  if (col.kind === 'partition_key') return 'Partition Key';
  if (col.kind === 'clustering') return `Clustering Key (${col.clustering_order})`;
  return '-';
}

function sortColumns(columns: ColumnInfo[]): ColumnInfo[] {
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

export function TableInfo({ keyspace, table }: Props) {
  const queryClient = useQueryClient();
  const [mapEditor, setMapEditor] = useState<MapEditorTarget | null>(null);

  const schemaQuery = useQuery<TableSchema>({
    queryKey: ['schema', keyspace, table],
    queryFn: () =>
      apiGet<TableSchema>(
        `/api/schema/keyspaces/${encodeURIComponent(keyspace)}/tables/${encodeURIComponent(table)}`,
      ),
  });

  const metadataQuery = useQuery<Record<string, ColumnMetadata>>({
    queryKey: ['metadata', keyspace, table],
    queryFn: () => getMetadata(keyspace, table),
  });

  const mutation = useMutation({
    mutationFn: (vars: { column: string; metadata: ColumnMetadata }) =>
      apiSetColumnMetadata(keyspace, table, vars.column, vars.metadata),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['metadata', keyspace, table] });
    },
  });

  const sortedColumns = useMemo(
    () => (schemaQuery.data ? sortColumns(schemaQuery.data.columns) : []),
    [schemaQuery.data],
  );

  if (schemaQuery.isLoading || metadataQuery.isLoading) {
    return <div className="text-sm text-slate-500">Loading table info...</div>;
  }

  if (schemaQuery.isError) {
    const err = schemaQuery.error as Error;
    return (
      <div className="text-sm text-red-600">
        Failed to load schema: {err.message}
      </div>
    );
  }

  if (metadataQuery.isError) {
    const err = metadataQuery.error as Error;
    return (
      <div className="text-sm text-red-600">
        Failed to load metadata: {err.message}
      </div>
    );
  }

  if (!schemaQuery.data) {
    return <div className="text-sm text-slate-500">No schema available.</div>;
  }

  const metadata = metadataQuery.data ?? {};

  const updateColumn = (column: string, patch: Partial<ColumnMetadata>) => {
    const current: ColumnMetadata = metadata[column] ?? {};
    const next: ColumnMetadata = { ...current, ...patch };
    mutation.mutate({ column, metadata: next });
  };

  const handleSaveMapSchema = (entries: MapSchemaEntry[]) => {
    if (!mapEditor) return;
    const column = mapEditor.column;
    const current: ColumnMetadata = metadata[column] ?? {};
    mutation.mutate(
      { column, metadata: { ...current, map_schema: entries } },
      {
        onSuccess: () => setMapEditor(null),
      },
    );
  };

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Table Schema</h2>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Column Name</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Key Type</th>
              <th className="px-3 py-2 font-semibold">Hide</th>
              <th className="px-3 py-2 font-semibold">Map Schema</th>
            </tr>
          </thead>
          <tbody>
            {sortedColumns.map((col) => {
              const meta: ColumnMetadata = metadata[col.name] ?? {};
              const root = rootCqlType(col.cql_type);
              const isMap = root === 'map';
              const isText = col.cql_type === 'text';
              const displayType = meta.display_type ?? 'text';
              const hide = meta.hide ?? false;
              return (
                <tr key={col.name} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-mono">{col.name}</td>
                  <td className="px-3 py-2">
                    {isText ? (
                      <select
                        value={displayType}
                        onChange={(e) =>
                          updateColumn(col.name, { display_type: e.target.value })
                        }
                        disabled={mutation.isPending}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                      >
                        <option value="text">text</option>
                        <option value="JSON">JSON</option>
                      </select>
                    ) : (
                      <span className="font-mono text-slate-700">{col.cql_type}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{keyKindLabel(col)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={hide}
                      onChange={(e) =>
                        updateColumn(col.name, { hide: e.target.checked })
                      }
                      disabled={mutation.isPending}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {isMap ? (
                      <button
                        type="button"
                        onClick={() =>
                          setMapEditor({
                            column: col.name,
                            current: meta.map_schema ?? [],
                          })
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Edit Schema
                      </button>
                    ) : (
                      <span className="text-slate-400">N/A</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {mutation.isError ? (
        <div className="mt-3 text-sm text-red-600">
          Save failed: {(mutation.error as Error).message}
        </div>
      ) : null}

      {mapEditor ? (
        <MapSchemaEditor
          column={mapEditor.column}
          initial={mapEditor.current}
          onSave={handleSaveMapSchema}
          onCancel={() => setMapEditor(null)}
          saving={mutation.isPending}
        />
      ) : null}
    </div>
  );
}
