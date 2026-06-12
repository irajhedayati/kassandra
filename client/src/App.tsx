import { useState } from 'react';
import { useConnectionStatus } from './state/connection.js';
import { useSelection } from './state/selection.js';
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
  const [tab, setTab] = useState<Tab>('data');

  return (
    <div className="flex h-full bg-slate-100">
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-slate-800/40 bg-slate-900 text-slate-200">
        <div className="border-b border-slate-800/60 px-6 py-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">
              k
            </span>
            <h1 className="text-lg font-semibold text-white">kassandra</h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">Cassandra GUI</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <ConnectionPanel />
          {connected && (
            <>
              <hr className="my-5 border-slate-800/60" />
              <SchemaNavigator />
            </>
          )}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center border-b border-slate-200 bg-white px-6 shadow-sm">
          <div className="text-sm text-slate-500">
            {connected ? (
              <>
                <span className="font-medium text-slate-700">
                  {status?.profileName ?? 'Connected'}
                </span>
                {keyspace ? (
                  <>
                    <span className="px-2 text-slate-300">/</span>
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

        <div className="flex-1 overflow-auto p-6">
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
                {tab === 'insert' && <InsertForm keyspace={keyspace} table={table} />}
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
