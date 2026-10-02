/**
 * Sidebar schema navigator: keyspace dropdown, table dropdown, refresh button.
 * Updates the global useSelection store.
 *
 * Owned by the schema lane.
 */
import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KeyspaceList, TableList } from '@kassandra/shared';
import { listKeyspaces, listTables } from '../../api/schema.js';
import { useSelection } from '../../state/selection.js';
import { useConnectionStatus } from '../../state/connection.js';
import { useFavoriteKeyspaces } from '../../state/favorites.js';
import { CreateKeyspaceDialog } from '../Dialogs/CreateKeyspaceDialog.js';
import { SearchableSelect } from './SearchableSelect.js';

export function SchemaNavigator() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { keyspace, table, setKeyspace, setTable } = useSelection();
  const { data: status } = useConnectionStatus();
  const { favorites } = useFavoriteKeyspaces(status?.profileName);

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

  const keyspaces = keyspacesQuery.data?.keyspaces ?? [];
  const orderedKeyspaces = [
    ...favorites.filter((k) => keyspaces.includes(k)).sort(),
    ...keyspaces.filter((k) => !favorites.includes(k)),
  ];
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
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchableSelect
              value={keyspace}
              options={orderedKeyspaces}
              onChange={setKeyspace}
              disabled={keyspacesQuery.isLoading || keyspaces.length === 0}
              placeholder={
                keyspacesQuery.isLoading
                  ? 'Loading…'
                  : keyspaces.length === 0
                    ? 'No keyspaces'
                    : 'Select keyspace'
              }
            />
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label="Create keyspace"
            title="Create keyspace"
            className="rounded-md border border-slate-700 px-2.5 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </div>
        {keyspacesQuery.isError && (
          <p className="text-xs text-red-400">
            {(keyspacesQuery.error as Error).message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">Table</label>
        <SearchableSelect
          value={table}
          options={tables}
          onChange={setTable}
          disabled={!keyspace || tablesQuery.isLoading || tables.length === 0}
          placeholder={
            !keyspace
              ? 'Select keyspace first'
              : tablesQuery.isLoading
                ? 'Loading…'
                : tables.length === 0
                  ? 'No tables'
                  : 'Select table'
          }
        />
        {tablesQuery.isError && (
          <p className="text-xs text-red-400">
            {(tablesQuery.error as Error).message}
          </p>
        )}
      </div>
      <CreateKeyspaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
