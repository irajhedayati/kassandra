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
    <div className="flex h-full">
      <aside className="w-72 shrink-0 border-r border-slate-200 bg-white p-4 overflow-y-auto">
        <h1 className="text-lg font-semibold mb-4">py-sandra</h1>
        <ConnectionPanel />
        {connected && (
          <>
            <hr className="my-4" />
            <SchemaNavigator />
          </>
        )}
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        {!connected ? (
          <div className="m-8 rounded border border-slate-200 bg-white p-6 text-slate-600">
            Connect to a Cassandra cluster from the sidebar to get started.
          </div>
        ) : !keyspace || !table ? (
          <div className="m-8 rounded border border-slate-200 bg-white p-6 text-slate-600">
            Select a keyspace and table from the sidebar.
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 bg-white px-6">
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
            <div className="flex-1 overflow-auto p-6">
              {tab === 'data' && <DataGrid keyspace={keyspace} table={table} />}
              {tab === 'insert' && <InsertForm keyspace={keyspace} table={table} />}
              {tab === 'info' && <TableInfo keyspace={keyspace} table={table} />}
            </div>
          </>
        )}
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
      className={`-mb-px border-b-2 py-3 ${
        props.active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {props.children}
    </button>
  );
}
