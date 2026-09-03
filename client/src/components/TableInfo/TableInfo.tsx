/**
 * Table info panel: schema readout (column name, type, key kind, hide,
 * map-schema editor for map columns).
 *
 * Edits are held in local draft state and only persisted when the user
 * clicks Save; Cancel discards them and reverts to the last saved metadata.
 *
 * Owned by the metadata/info lane.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ColumnInfo,
  ColumnMetadata,
  MapSchemaEntry,
  TableSchema,
} from '@kassandra/shared';
import { rootCqlType } from '@kassandra/shared';
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

function enumValuesToText(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}

function parseEnumValuesText(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

export function TableInfo({ keyspace, table }: Props) {
  const queryClient = useQueryClient();
  const [mapEditor, setMapEditor] = useState<MapEditorTarget | null>(null);
  const [enumDrafts, setEnumDrafts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, ColumnMetadata>>({});
  const draftKeyRef = useRef<string | null>(null);

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

  const metadata = useMemo(() => metadataQuery.data ?? {}, [metadataQuery.data]);

  // Seed the draft from the server once per table; further server refetches
  // must not clobber in-progress local edits.
  useEffect(() => {
    const key = `${keyspace}.${table}`;
    if (metadataQuery.data && draftKeyRef.current !== key) {
      setDraft(metadataQuery.data);
      draftKeyRef.current = key;
      setEnumDrafts({});
    }
  }, [keyspace, table, metadataQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (entries: { column: string; metadata: ColumnMetadata }[]) => {
      await Promise.all(
        entries.map((e) => apiSetColumnMetadata(keyspace, table, e.column, e.metadata)),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['metadata', keyspace, table] });
    },
  });

  const sortedColumns = useMemo(
    () => (schemaQuery.data ? sortColumns(schemaQuery.data.columns) : []),
    [schemaQuery.data],
  );

  const isDirty = JSON.stringify(draft) !== JSON.stringify(metadata);

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

  const updateDraftColumn = (column: string, patch: Partial<ColumnMetadata>) => {
    setDraft((prev) => ({
      ...prev,
      [column]: { ...(prev[column] ?? {}), ...patch },
    }));
  };

  const handleSaveMapSchema = (entries: MapSchemaEntry[]) => {
    if (!mapEditor) return;
    updateDraftColumn(mapEditor.column, { map_schema: entries });
    setMapEditor(null);
  };

  const handleEnumValuesBlur = (column: string) => {
    const text = enumDrafts[column];
    if (text === undefined) return;
    updateDraftColumn(column, { enum_values: parseEnumValuesText(text) });
  };

  const handleSave = () => {
    const changed = Object.entries(draft)
      .filter(([col, m]) => JSON.stringify(m) !== JSON.stringify(metadata[col] ?? {}))
      .map(([column, meta]) => ({ column, metadata: meta }));
    if (changed.length === 0) return;
    saveMutation.mutate(changed);
  };

  const handleCancel = () => {
    setDraft(metadata);
    setEnumDrafts({});
    setMapEditor(null);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Table Schema</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={!isDirty || saveMutation.isPending}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
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
              const meta: ColumnMetadata = draft[col.name] ?? {};
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
                      <div className="flex flex-col gap-1">
                        <select
                          value={displayType}
                          onChange={(e) =>
                            updateDraftColumn(col.name, { display_type: e.target.value })
                          }
                          disabled={saveMutation.isPending}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                        >
                          <option value="text">text</option>
                          <option value="JSON">JSON</option>
                          <option value="enum">enum</option>
                        </select>
                        {displayType === 'enum' && (
                          <input
                            type="text"
                            value={enumDrafts[col.name] ?? enumValuesToText(meta.enum_values)}
                            onChange={(e) =>
                              setEnumDrafts((d) => ({ ...d, [col.name]: e.target.value }))
                            }
                            onBlur={() => handleEnumValuesBlur(col.name)}
                            disabled={saveMutation.isPending}
                            placeholder="value1, value2, value3"
                            className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                          />
                        )}
                      </div>
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
                        updateDraftColumn(col.name, { hide: e.target.checked })
                      }
                      disabled={saveMutation.isPending}
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

      {saveMutation.isError ? (
        <div className="mt-3 text-sm text-red-600">
          Save failed: {(saveMutation.error as Error).message}
        </div>
      ) : null}

      {mapEditor ? (
        <MapSchemaEditor
          column={mapEditor.column}
          initial={mapEditor.current}
          onSave={handleSaveMapSchema}
          onCancel={() => setMapEditor(null)}
        />
      ) : null}
    </div>
  );
}
