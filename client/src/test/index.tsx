/**
 * Render helpers for client component tests. Import everything from here:
 *
 *   // @vitest-environment jsdom
 *   import { connectionStatus, mockApi, ok, renderWithProviders, screen } from '../../test/index.js';
 *
 * Importing it also loads the common setup (setup.ts).
 */
import './setup.js';
import type { ReactElement } from 'react';
import { act, render, waitFor, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import type { ConnectionStatus } from '@kassandra/shared';

export * from '@testing-library/react';
export { userEvent };
export * from './api.js';

/** A query client for one test: no retries, so a failed request shows up at once. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Render `ui` inside the providers the app uses (a fresh TanStack Query client),
 * with a user-event session for interactions. Returns Testing Library's result
 * plus `queryClient` (e.g. to invalidate a query, as the app does after connecting)
 * and `user`.
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = createTestQueryClient();
  const user = userEvent.setup();
  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  return { ...result, queryClient, user };
}

/**
 * Wait until a query has loaded and the components using it have re-rendered.
 * Use it before asserting what a component shows once some data has arrived,
 * when that is also what it shows before (e.g. buttons that are only hidden
 * for read-only profiles): `await waitForQuery(queryClient, ['connection', 'status'])`.
 */
export async function waitForQuery(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  await waitFor(() => {
    if (queryClient.getQueryState(queryKey)?.status !== 'success') throw new Error(`query ${JSON.stringify(queryKey)} has not loaded`);
  });
  await act(async () => {});
}

/** `/api/profiles/status` for a tab connected to profile `prod`; override any field. */
export function connectionStatus(overrides: Partial<ConnectionStatus> = {}): ConnectionStatus {
  return { connected: true, profileName: 'prod', keyspace: null, readOnly: false, ...overrides };
}
