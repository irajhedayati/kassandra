// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { TableSchema } from '@kassandra/shared';
import { act, connectionStatus, mockApi, ok, renderWithProviders, screen, waitForQuery } from '../../test/index.js';
import { RowDetail } from './RowDetail.js';

vi.mock('@monaco-editor/react', () => import('../../test/monaco.js'));

const schema: TableSchema = {
  keyspace: 'ks',
  table_name: 't',
  columns: [
    { name: 'k', cql_type: 'int', kind: 'partition_key', position: 0, clustering_order: 'ASC' },
    { name: 'v', cql_type: 'text', kind: 'regular', position: -1, clustering_order: 'ASC' },
  ],
};

const renderRowDetail = () =>
  renderWithProviders(
    <RowDetail open keyspace="ks" table="t" schema={schema} row={{ k: 1, v: 'a' }} onClose={() => {}} />,
  );

const pressAltD = (user: ReturnType<typeof renderRowDetail>['user']) => user.keyboard('{Alt>}d{/Alt}');
const confirmation = () => screen.queryByRole('heading', { name: 'Delete this row?' });

describe('RowDetail', () => {
  describe('with a read-only profile', () => {
    it('offers no Edit or Delete, and explains why', async () => {
      mockApi({ 'GET /api/profiles/status': ok(connectionStatus({ readOnly: true })) });
      renderRowDetail();
      expect(await screen.findByText(/read-only, so rows can't be edited or deleted/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    });

    it('ignores the Option/Alt+D delete shortcut', async () => {
      mockApi({ 'GET /api/profiles/status': ok(connectionStatus({ readOnly: true })) });
      const { user } = renderRowDetail();
      await screen.findByText(/read-only/);
      await pressAltD(user);
      expect(confirmation()).not.toBeInTheDocument();
    });
  });

  describe('with a writable profile', () => {
    it('offers Edit and Delete', async () => {
      mockApi({ 'GET /api/profiles/status': ok(connectionStatus()) });
      const { queryClient } = renderRowDetail();
      await waitForQuery(queryClient, ['connection', 'status']);
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
      expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
    });

    it('opens the delete confirmation with Option/Alt+D', async () => {
      mockApi({ 'GET /api/profiles/status': ok(connectionStatus()) });
      const { user, queryClient } = renderRowDetail();
      await waitForQuery(queryClient, ['connection', 'status']);
      await pressAltD(user);
      expect(confirmation()).toBeInTheDocument();
    });
  });

  it('brings Edit and Delete back, without a reload, when the tab reconnects with a writable profile', async () => {
    const api = mockApi({ 'GET /api/profiles/status': ok(connectionStatus({ readOnly: true })) });
    const { queryClient } = renderRowDetail();
    await screen.findByText(/read-only/);

    // What the connection panel does after connecting: refetch the status.
    api.set('GET /api/profiles/status', ok(connectionStatus({ readOnly: false })));
    await act(() => queryClient.invalidateQueries({ queryKey: ['connection', 'status'] }));

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
  });
});
