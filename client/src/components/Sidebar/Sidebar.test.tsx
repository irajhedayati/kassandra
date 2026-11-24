// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { connectionStatus, mockApi, ok, renderWithProviders, screen, waitFor, waitForQuery } from '../../test/index.js';
import { useSelection } from '../../state/selection.js';
import { ConnectionPanel } from './ConnectionPanel.js';
import { SchemaNavigator } from './SchemaNavigator.js';

const schemaRoutes = (readOnly: boolean) => ({
  'GET /api/profiles/status': ok(connectionStatus({ readOnly, keyspace: 'ks' })),
  'GET /api/profiles/prod/favorites': ok([]),
  'GET /api/schema/keyspaces': ok({ keyspaces: ['ks'] }),
  'GET /api/schema/keyspaces/ks/tables': ok({ tables: ['t'] }),
});

describe('SchemaNavigator', () => {
  it('has no create keyspace or create table buttons with a read-only profile', async () => {
    mockApi(schemaRoutes(true));
    useSelection.setState({ keyspace: 'ks' });
    renderWithProviders(<SchemaNavigator />);
    // Until the status arrives the profile counts as writable, so wait for the buttons to go.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create keyspace' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Create table' })).not.toBeInTheDocument();
    expect(await screen.findByText('Select table')).toBeInTheDocument();
  });

  it('has both with a writable profile', async () => {
    mockApi(schemaRoutes(false));
    useSelection.setState({ keyspace: 'ks' });
    const { queryClient } = renderWithProviders(<SchemaNavigator />);
    await waitForQuery(queryClient, ['connection', 'status']);
    expect(screen.getByRole('button', { name: 'Create keyspace' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Create table' })).toBeEnabled();
  });
});

describe('ConnectionPanel', () => {
  const panelRoutes = (readOnly: boolean) => ({
    'GET /api/profiles': ok([{ ...DEFAULT_PROFILE, name: 'prod', read_only: readOnly }]),
    'GET /api/profiles/status': ok(connectionStatus({ readOnly })),
  });

  it('shows a Read-only badge while connected with a read-only profile', async () => {
    mockApi(panelRoutes(true));
    renderWithProviders(<ConnectionPanel />);
    expect(await screen.findByText(/Connected as/)).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('shows no badge with a writable profile', async () => {
    mockApi(panelRoutes(false));
    renderWithProviders(<ConnectionPanel />);
    expect(await screen.findByText(/Connected as/)).toBeInTheDocument();
    expect(screen.queryByText('Read-only')).not.toBeInTheDocument();
  });
});
