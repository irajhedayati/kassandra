/**
 * `mockApi` replaces `fetch` for one test with the API routes the test expects.
 *
 *   const api = mockApi({
 *     'GET /api/profiles/status': ok({ connected: true, profileName: 'prod', keyspace: null, readOnly: true }),
 *     'POST /api/cql': (req) => queryResult({ success: true, rows: [], pagingState: null, hasMorePages: false }),
 *   });
 *   api.set('GET /api/profiles/status', ok({ ...status, readOnly: false })); // change a route mid-test
 *   expect(api.calls('POST /api/cql')[0]!.body).toEqual({ query: 'SELECT 1', ... });
 *
 * Routes are `"<METHOD> <path>"`, matched on the path without its query string.
 * A request for a route that isn't listed rejects, and fails the test after it
 * ends with a message naming the request (the component may swallow the
 * rejection, the test doesn't). So a test states every API call it relies on.
 */
import type { ApiResponse, QueryResponse } from '@kassandra/shared';
import { vi } from 'vitest';

export interface ApiRequest {
  method: string;
  /** Path without the query string, e.g. `/api/schema/keyspaces`. */
  path: string;
  /** The URL as requested, query string included. */
  url: string;
  /** Parsed JSON body, undefined when there is none. */
  body: unknown;
}

export interface ApiReply {
  status?: number;
  body: unknown;
}

export type ApiHandler = ApiReply | ((req: ApiRequest) => ApiReply | Promise<ApiReply>);

/** A successful `ApiOk<T>` reply (`{ ok: true, data }`), as most routes send. */
export function ok<T>(data: T): ApiReply {
  return { body: { ok: true, data } satisfies ApiResponse<T> };
}

/** A failed `ApiErr` reply (`{ ok: false, message }`). */
export function apiError(message: string, status = 400): ApiReply {
  return { status, body: { ok: false, message } satisfies ApiResponse<never> };
}

/** A `QueryResponse` reply, as the data and CQL routes send (no `ok` envelope). */
export function queryResult(response: QueryResponse, status = 200): ApiReply {
  return { status, body: response };
}

export interface ApiMock {
  /** Add or replace a route. */
  set(route: string, handler: ApiHandler): void;
  /** Requests made to a route so far, oldest first. */
  calls(route: string): ApiRequest[];
  /** Requests that matched no route, as `"<METHOD> <url>"`; clears the list. */
  takeUnexpected(): string[];
}

let active: (ApiMock & { unexpected: string[] }) | null = null;

export function mockApi(routes: Record<string, ApiHandler> = {}): ApiMock {
  const handlers = new Map(Object.entries(routes));
  const requests = new Map<string, ApiRequest[]>();
  const unexpected: string[] = [];

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = new URL(url, 'http://localhost').pathname;
    const route = `${method} ${path}`;
    const handler = handlers.get(route);
    if (!handler) {
      unexpected.push(`${method} ${url}`);
      throw new Error(`Unexpected API request: ${method} ${url} (not in mockApi)`);
    }
    const body = typeof init.body === 'string' && init.body !== '' ? JSON.parse(init.body) : undefined;
    const request: ApiRequest = { method, path, url, body };
    requests.set(route, [...(requests.get(route) ?? []), request]);
    const reply = typeof handler === 'function' ? await handler(request) : handler;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  active = {
    unexpected,
    set: (route, handler) => void handlers.set(route, handler),
    calls: (route) => [...(requests.get(route) ?? [])],
    takeUnexpected: () => unexpected.splice(0),
  };
  return active;
}

/** Called after each test (see setup.ts): throws when the test made requests its mockApi didn't list. */
export function verifyApiMock(): void {
  const mock = active;
  active = null;
  const unexpected = mock?.takeUnexpected() ?? [];
  if (unexpected.length > 0) {
    throw new Error(
      `The test made API requests that mockApi() doesn't list:\n${unexpected.map((r) => `  ${r}`).join('\n')}\n` +
        'Add them to the routes passed to mockApi().',
    );
  }
}
