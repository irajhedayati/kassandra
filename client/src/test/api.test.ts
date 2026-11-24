import { describe, expect, it } from 'vitest';
import { apiError, mockApi, ok, queryResult, verifyApiMock } from './index.js';

describe('mockApi', () => {
  it('answers the listed routes, matching method and path without the query string', async () => {
    const api = mockApi({ 'GET /api/schema/keyspaces': ok({ keyspaces: ['ks'] }) });
    const res = await fetch('/api/schema/keyspaces?refresh=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { keyspaces: ['ks'] } });
    expect(api.calls('GET /api/schema/keyspaces')).toMatchObject([{ method: 'GET', url: '/api/schema/keyspaces?refresh=1' }]);
  });

  it('passes the parsed body to a handler and records it', async () => {
    const api = mockApi({
      'POST /api/cql': (req) =>
        queryResult({ success: true, rows: [{ q: (req.body as { query: string }).query }], pagingState: null, hasMorePages: false }),
    });
    const res = await fetch('/api/cql', { method: 'POST', body: JSON.stringify({ query: 'SELECT 1' }) });
    expect((await res.json()).rows).toEqual([{ q: 'SELECT 1' }]);
    expect(api.calls('POST /api/cql')[0]!.body).toEqual({ query: 'SELECT 1' });
  });

  it('replies with the given status and error envelope', async () => {
    mockApi({ 'DELETE /api/profiles/prod': apiError('nope', 409) });
    const res = await fetch('/api/profiles/prod', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, message: 'nope' });
  });

  it('lets a test change a route', async () => {
    const api = mockApi({ 'GET /api/about': ok({ version: '1' }) });
    api.set('GET /api/about', ok({ version: '2' }));
    expect((await (await fetch('/api/about')).json()).data).toEqual({ version: '2' });
  });

  it('rejects a request for a route that is not listed, and fails the test naming it', async () => {
    mockApi({ 'GET /api/about': ok({}) });
    await expect(fetch('/api/profiles/status')).rejects.toThrow('Unexpected API request: GET /api/profiles/status');
    await expect(fetch('/api/cql', { method: 'POST', body: '{}' })).rejects.toThrow('POST /api/cql');
    // This is what runs after every test (setup.ts); called here so this test itself passes.
    expect(() => verifyApiMock()).toThrow(
      "The test made API requests that mockApi() doesn't list:\n  GET /api/profiles/status\n  POST /api/cql\n",
    );
  });
});
