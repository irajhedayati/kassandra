import { useState } from 'react';
import { useConnectionStatus } from './state/connection.js';
import { useSelection } from './state/selection.js';
import { useFavoriteKeyspaces } from './state/favorites.js';
import { ConnectionPanel } from './components/Sidebar/ConnectionPanel.js';
import { SchemaNavigator } from './components/Sidebar/SchemaNavigator.js';
import { DataGrid } from './components/DataGrid/DataGrid.js';
import { InsertForm } from './components/Forms/InsertForm.js';
import { TableInfo } from './components/TableInfo/TableInfo.js';
import { CqlEditor } from './components/CqlEditor/CqlEditor.js';

type Tab = 'data' | 'insert' | 'info';

export function App() {
  const { data: status } = useConnectionStatus();
  const connected = !!status?.connected;
  const { keyspace, table } = useSelection();
  const { isFavorite, toggleFavorite } = useFavoriteKeyspaces(status?.profileName);
  const [tab, setTab] = useState<Tab>('data');

  return (
    <div className="flex h-full bg-slate-100">
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-cyan-400/20 bg-gradient-to-b from-blue-950 via-blue-900 to-cyan-950 text-slate-200">
        <div className="border-b border-cyan-400/20 px-6 py-5">
          <img
            src="/logo.png"
            alt="Kassandra — GUI for Cassandra databases"
            className="w-full rounded-lg bg-white shadow-lg shadow-blue-950/30 ring-1 ring-cyan-300/30"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <ConnectionPanel />
          {connected && (
            <>
              <hr className="my-5 border-cyan-400/20" />
              <SchemaNavigator />
            </>
          )}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center border-b border-blue-200 bg-gradient-to-r from-white via-blue-50 to-cyan-50 px-6 shadow-sm">
          <div className="text-sm text-slate-500">
            {connected ? (
              <>
                <span className="font-medium text-slate-700">
                  {status?.profileName ?? 'Connected'}
                </span>
                {keyspace ? (
                  <>
                    <span className="px-2 text-slate-300">/</span>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(keyspace)}
                      className={`mr-1 align-middle ${
                        isFavorite(keyspace)
                          ? 'text-amber-400'
                          : 'text-slate-300 hover:text-amber-400'
                      }`}
                      title={isFavorite(keyspace) ? 'Unfavorite keyspace' : 'Favorite keyspace'}
                      aria-label={
                        isFavorite(keyspace) ? 'Unfavorite keyspace' : 'Favorite keyspace'
                      }
                    >
                      {isFavorite(keyspace) ? '★' : '☆'}
                    </button>
                    <span className="text-slate-700">{keyspace}</span>
                  </>
                ) : null}
                {table ? (
                  <>
                    <span className="px-2 text-slate-300">/</span>
                    <span className="font-medium text-slate-800">{table}</span>
                  </>
                ) : null}
              </>
            ) : (
              <>Not connected</>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-gradient-to-br from-slate-100 via-blue-50/40 to-cyan-50/60 p-6">
          {!connected ? (
            <div className="card p-6 text-slate-600">
              Connect to a Cassandra cluster from the sidebar to get started.
            </div>
          ) : !keyspace || !table ? (
            <div className="card p-6 text-slate-600">
              Select a keyspace and table from the sidebar.
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="border-b border-slate-200 px-6">
                <nav className="flex gap-6 text-sm">
                  <TabButton active={tab === 'data'} onClick={() => setTab('data')}>
                    Data Browser
                  </TabButton>
                  <TabButton active={tab === 'insert'} onClick={() => setTab('insert')}>
                    Insert Record
                  </TabButton>
                  <TabButton active={tab === 'info'} onClick={() => setTab('info')}>
                    Table Info
                  </TabButton>
                </nav>
              </div>
              <div className="p-6">
                {tab === 'data' && <DataGrid keyspace={keyspace} table={table} />}
                {tab === 'insert' && (
                  <InsertForm keyspace={keyspace} table={table} onCancel={() => setTab('data')} />
                )}
                {tab === 'info' && <TableInfo keyspace={keyspace} table={table} />}
              </div>
            </div>
          )}
        </div>

        {connected && (
          <div className="border-t border-slate-200 bg-white">
            <CqlEditor />
          </div>
        )}
      </main>
    </div>
  );
}

function TabButton(props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`-mb-px border-b-2 py-3 transition ${
        props.active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {props.children}
    </button>
  );
}
