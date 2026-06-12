/**
 * Sidebar schema navigator: keyspace dropdown, table dropdown, refresh button.
 * Updates the global useSelection store.
 *
 * Owned by the schema lane.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KeyspaceList, TableList } from '@kassandra/shared';
import { listKeyspaces, listTables } from '../../api/schema.js';
import { useSelection } from '../../state/selection.js';

export function SchemaNavigator() {
  const queryClient = useQueryClient();
  const { keyspace, table, setKeyspace, setTable } = useSelection();

  const keyspacesQuery = useQuery<KeyspaceList>({
    queryKey: ['schema', 'keyspaces'],
    queryFn: listKeyspaces,
  });

  const tablesQuery = useQuery<TableList>({
    queryKey: ['schema', 'tables', keyspace],
    queryFn: () => listTables(keyspace as string),
    enabled: !!keyspace,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['schema', 'keyspaces'] });
    if (keyspace) {
      queryClient.invalidateQueries({ queryKey: ['schema', 'tables', keyspace] });
    }
  };

  const onKeyspaceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setKeyspace(value === '' ? null : value);
  };

  const onTableChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setTable(value === '' ? null : value);
  };

  const keyspaces = keyspacesQuery.data?.keyspaces ?? [];
  const tables = tablesQuery.data?.tables ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Schema
        </h2>
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          disabled={keyspacesQuery.isFetching || tablesQuery.isFetching}
        >
          Refresh
        </button>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">Keyspace</label>
        <select
          value={keyspace ?? ''}
          onChange={onKeyspaceChange}
          disabled={keyspacesQuery.isLoading || keyspaces.length === 0}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
        >
          <option value="" className="bg-slate-800">
            {keyspacesQuery.isLoading
              ? 'Loading…'
              : keyspaces.length === 0
                ? 'No keyspaces'
                : 'Select keyspace'}
          </option>
          {keyspaces.map((ks) => (
            <option key={ks} value={ks} className="bg-slate-800">
              {ks}
            </option>
          ))}
        </select>
        {keyspacesQuery.isError && (
          <p className="text-xs text-red-400">
            {(keyspacesQuery.error as Error).message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">Table</label>
        <select
          value={table ?? ''}
          onChange={onTableChange}
          disabled={!keyspace || tablesQuery.isLoading || tables.length === 0}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
        >
          <option value="" className="bg-slate-800">
            {!keyspace
              ? 'Select keyspace first'
              : tablesQuery.isLoading
                ? 'Loading…'
                : tables.length === 0
                  ? 'No tables'
                  : 'Select table'}
          </option>
          {tables.map((t) => (
            <option key={t} value={t} className="bg-slate-800">
              {t}
            </option>
          ))}
        </select>
        {tablesQuery.isError && (
          <p className="text-xs text-red-400">
            {(tablesQuery.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
