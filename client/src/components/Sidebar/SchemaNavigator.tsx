/**
 * Sidebar schema navigator: keyspace dropdown, table dropdown, refresh button.
 * Updates the global useSelection store.
 *
 * Owned by the schema lane.
 */
import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KeyspaceList, TableList } from '@kassandra/shared';
import { listKeyspaces, listTables } from '../../api/schema.js';
import { useSelection } from '../../state/selection.js';
import { useConnectionStatus } from '../../state/connection.js';
import { useFavoriteKeyspaces } from '../../state/favorites.js';
import { CreateTableDialog } from '../Dialogs/CreateTableDialog.js';
import { CreateKeyspaceDialog } from '../Dialogs/CreateKeyspaceDialog.js';
import { SearchableSelect, type SearchableSelectHandle } from './SearchableSelect.js';

export function SchemaNavigator() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const { keyspace, table, setKeyspace, setTable } = useSelection();
  const { data: status } = useConnectionStatus();
  const { favorites } = useFavoriteKeyspaces(status?.profileName);

  const keyspaceSelectRef = useRef<SearchableSelectHandle>(null);
  const tableSelectRef = useRef<SearchableSelectHandle>(null);

  // Cmd/Ctrl+D opens the keyspace selector, Cmd/Ctrl+T the table selector.
  // Safari and some other browsers reserve those (bookmark / new tab), so
  // Option/Alt+K and Option/Alt+T do the same. Modifier combos never type
  // text, so they work from inputs too, except in the CQL editor where
  // Cmd/Ctrl+D is Monaco's "add selection to next match". Alt combos match on
  // `code` because Option+letter types a different character on macOS.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey) return;
      let target: 'keyspace' | 'table' | null = null;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        target = key === 'd' ? 'keyspace' : key === 't' ? 'table' : null;
      } else if (e.altKey && !e.metaKey && !e.ctrlKey) {
        target = e.code === 'KeyK' ? 'keyspace' : e.code === 'KeyT' ? 'table' : null;
      }
      if (!target) return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
      e.preventDefault();
      (target === 'keyspace' ? keyspaceSelectRef : tableSelectRef).current?.openAndFocus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
          Schema
        </h2>
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded-md border border-ink-700 px-2 py-1 text-xs text-ink-300 transition hover:bg-ink-800 disabled:opacity-50"
          disabled={keyspacesQuery.isFetching || tablesQuery.isFetching}
        >
          Refresh
        </button>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-ink-400">Keyspace</label>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchableSelect
              ref={keyspaceSelectRef}
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
            className="rounded-md border border-ink-700 px-2.5 py-2 text-xs text-ink-300 transition hover:bg-ink-800"
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
        <label className="block text-xs font-medium text-ink-400">Table</label>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchableSelect
              ref={tableSelectRef}
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
          </div>
          <button
            type="button"
            onClick={() => setCreateTableOpen(true)}
            disabled={!keyspace}
            aria-label="Create table"
            title={keyspace ? 'Create table' : 'Select a keyspace first'}
            className="rounded-md border border-ink-700 px-2.5 py-2 text-xs text-ink-300 transition hover:bg-ink-800 disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </div>
        {tablesQuery.isError && (
          <p className="text-xs text-red-400">
            {(tablesQuery.error as Error).message}
          </p>
        )}
      </div>
      <CreateTableDialog
        open={createTableOpen}
        keyspace={keyspace}
        onClose={() => setCreateTableOpen(false)}
      />
      <CreateKeyspaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
