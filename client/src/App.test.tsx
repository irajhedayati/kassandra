// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { SetupInfo, TableSchema } from '@kassandra/shared';
import {
  act,
  connectionStatus,
  mockApi,
  ok,
  queryResult,
  renderWithProviders,
  screen,
  waitFor,
  waitForQuery,
} from './test/index.js';
import { useSelection } from './state/selection.js';
import { App } from './App.js';

vi.mock('@monaco-editor/react', () => import('./test/monaco.js'));

const schema: TableSchema = {
  keyspace: 'ks',
  table_name: 't',
  columns: [
    { name: 'k', cql_type: 'int', kind: 'partition_key', position: 0, clustering_order: 'ASC' },
    { name: 'v', cql_type: 'text', kind: 'regular', position: -1, clustering_order: 'ASC' },
  ],
};

/** The app connected to `prod` with `ks.t` selected: every request it makes on the way. */
const appRoutes = (readOnly: boolean) => ({
  'GET /api/setup': ok({ firstRun: false } as SetupInfo),
  'GET /api/about': ok({ version: '1.7.0' }),
  'GET /api/profiles': ok([]),
  'GET /api/profiles/status': ok(connectionStatus({ readOnly, keyspace: 'ks' })),
  'GET /api/profiles/prod/favorites': ok([]),
  'GET /api/schema/keyspaces': ok({ keyspaces: ['ks'] }),
  'GET /api/schema/keyspaces/ks/tables': ok({ tables: ['t'] }),
  'GET /api/schema/keyspaces/ks/tables/t': ok(schema),
  'GET /api/metadata/ks/t': ok({}),
  'POST /api/data/ks/t/rows': queryResult({ success: true, rows: [{ k: 1, v: 'a' }], pagingState: null, hasMorePages: false }),
});

const renderApp = (readOnly: boolean) => {
  const api = mockApi(appRoutes(readOnly));
  useSelection.setState({ keyspace: 'ks', table: 't' });
  return { api, ...renderWithProviders(<App />) };
};

const insertTab = () => screen.queryByRole('button', { name: 'Insert Record' });

describe('App', () => {
  it('has no Insert Record tab with a read-only profile', async () => {
    const { queryClient } = renderApp(true);
    await waitForQuery(queryClient, ['connection', 'status']);
    expect(screen.getByRole('button', { name: 'Data Browser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table Info' })).toBeInTheDocument();
    expect(insertTab()).not.toBeInTheDocument();
  });

  it('has the Insert Record tab with a writable profile', async () => {
    const { queryClient } = renderApp(false);
    await waitForQuery(queryClient, ['connection', 'status']);
    expect(insertTab()).toBeInTheDocument();
  });

  it('brings the Insert Record tab back when the tab reconnects with a writable profile', async () => {
    const { api, queryClient } = renderApp(true);
    await waitForQuery(queryClient, ['connection', 'status']);
    expect(insertTab()).not.toBeInTheDocument();

    api.set('GET /api/profiles/status', ok(connectionStatus({ readOnly: false, keyspace: 'ks' })));
    await act(() => queryClient.invalidateQueries({ queryKey: ['connection', 'status'] }));

    await waitFor(() => expect(insertTab()).toBeInTheDocument());
  });

  it('renders the CQL editor with the Monaco stand-in', async () => {
    const { queryClient, user } = renderApp(false);
    await waitForQuery(queryClient, ['connection', 'status']);
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    await user.type(editor, 'SELECT * FROM ks.t');
    expect(editor).toHaveValue('SELECT * FROM ks.t');
  });
});
