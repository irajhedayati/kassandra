/**
 * Read-only connection profiles, through the Express app: what the routes run
 * and what they refuse while the connected profile is read-only. Cassandra is
 * a fake client that records every statement it is asked to execute.
 */
import http from 'node:http';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'cassandra-driver';
import { DEFAULT_PROFILE, type ConnectionProfile } from '@kassandra/shared';
import { createApp } from '../app.js';
import { closeAllSessions, runWithSession, SESSION_HEADER, setActive } from '../cassandra/state.js';

const SESSION = 'read-only-test';

/** system_schema.columns rows for `ks.t (k int PRIMARY KEY, v text)`. */
const COLUMNS = [
  { column_name: 'k', type: 'int', kind: 'partition_key', position: 0, clustering_order: 'none' },
  { column_name: 'v', type: 'text', kind: 'regular', position: -1, clustering_order: 'none' },
];

describe('read-only connection profiles', () => {
  const app = createApp();
  let execute: ReturnType<typeof vi.fn>;

  /** CQL the fake client was asked to run, without the schema lookups the routes make first. */
  const executed = () =>
    execute.mock.calls.map((c) => String(c[0])).filter((q) => !q.includes('system_schema.'));

  const connectAs = (profile: Partial<ConnectionProfile>) => {
    execute = vi.fn(async (query: string) => ({
      rows: query.includes('system_schema.columns') ? COLUMNS : [],
    }));
    const client = { execute, shutdown: vi.fn().mockResolvedValue(undefined) } as unknown as Client;
    runWithSession(SESSION, () =>
      setActive({ client, profile: { ...DEFAULT_PROFILE, name: 'prod', ...profile }, keyspace: 'ks' }),
    );
  };

  // Sandboxes may forbid listening sockets, so feed the app a fake request and capture the response.
  const call = (method: string, url: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const req = new http.IncomingMessage(new Socket());
      req.method = method;
      req.url = url;
      req.headers = {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
        [SESSION_HEADER]: SESSION,
      };
      if (payload) req.push(payload);
      req.push(null);
      const res = new http.ServerResponse(req);
      res.end = ((chunk?: unknown) => {
        resolve({ status: res.statusCode, json: chunk ? JSON.parse(String(chunk)) : undefined });
        return res;
      }) as typeof res.end;
      (app as unknown as http.RequestListener)(req, res);
    });

  const cql = (query: string) => call('POST', '/api/cql', { query });

  afterEach(() => closeAllSessions());

  describe('connected with a read-only profile', () => {
    beforeEach(() => connectAs({ read_only: true }));

    it('reports it in the connection status', async () => {
      const { json } = await call('GET', '/api/profiles/status');
      expect(json.data).toEqual({ connected: true, profileName: 'prod', keyspace: 'ks', readOnly: true });
    });

    it('runs SELECT, USE and LIST statements', async () => {
      expect(await cql('SELECT * FROM ks.t')).toMatchObject({ status: 200, json: { success: true } });
      expect(await cql('use ks')).toMatchObject({ status: 200, json: { success: true } });
      expect(await cql('LIST ROLES')).toMatchObject({ status: 200, json: { success: true } });
      expect(await cql('list all permissions of alice')).toMatchObject({ status: 200, json: { success: true } });
      expect(executed()).toEqual(['SELECT * FROM ks.t', 'use ks', 'LIST ROLES', 'list all permissions of alice']);
    });

    it('refuses writes and schema changes in the CQL editor without sending them to Cassandra', async () => {
      for (const [query, command] of [
        ["INSERT INTO ks.t (k, v) VALUES (1, 'a')", 'INSERT'],
        ['UPDATE ks.t SET v = :v WHERE k = 1', 'UPDATE'],
        ['DELETE FROM ks.t WHERE k = 1', 'DELETE'],
        ['TRUNCATE ks.t', 'TRUNCATE'],
        ['DROP TABLE ks.t', 'DROP'],
        ['CREATE TABLE ks.u (k int PRIMARY KEY)', 'CREATE'],
        ['/* SELECT */ ALTER TABLE ks.t ADD w text', 'ALTER'],
      ]) {
        const { status, json } = await cql(query!);
        expect(status).toBe(403);
        expect(json).toEqual({
          success: false,
          message: `This connection profile is read-only: ${command} is not allowed. Only SELECT, USE and LIST statements can run.`,
        });
      }
      expect(executed()).toEqual([]);
    });

    it('refuses a batch, and a write hidden after a read', async () => {
      const batch = await cql("BEGIN BATCH INSERT INTO ks.t (k, v) VALUES (1, 'SELECT'); APPLY BATCH");
      expect(batch.status).toBe(403);
      expect(batch.json.message).toContain('BATCH is not allowed');

      const mixed = await cql('SELECT * FROM ks.t; DROP TABLE ks.t');
      expect(mixed.status).toBe(403);
      expect(mixed.json.message).toContain('DROP (statement #2) is not allowed');
      expect(executed()).toEqual([]);
    });

    it('still browses rows', async () => {
      const { status, json } = await call('POST', '/api/data/ks/t/rows', { pageSize: 10 });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(executed()).toEqual(['SELECT * FROM "ks"."t"']);
    });

    it('refuses inserting, updating and deleting rows', async () => {
      const insert = await call('POST', '/api/data/ks/t/rows/insert', { values: { k: 1, v: 'a' } });
      const update = await call('PUT', '/api/data/ks/t/rows', { keys: { k: 1 }, updates: { v: 'b' } });
      const remove = await call('DELETE', '/api/data/ks/t/rows', { keys: { k: 1 } });
      for (const [res, action] of [
        [insert, 'Inserting rows'],
        [update, 'Updating rows'],
        [remove, 'Deleting rows'],
      ] as const) {
        expect(res.status).toBe(403);
        expect(res.json).toEqual({
          success: false,
          message: `This connection profile is read-only: ${action} is not allowed. Only SELECT, USE and LIST statements can run.`,
        });
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('refuses creating keyspaces and tables, but still lists them', async () => {
      const keyspace = await call('POST', '/api/schema/keyspaces', {
        name: 'ks2',
        strategy: 'SimpleStrategy',
        replicationFactor: 1,
        durableWrites: true,
        ifNotExists: false,
      });
      expect(keyspace.status).toBe(403);
      expect(keyspace.json).toEqual({ ok: false, message: expect.stringContaining('Creating keyspaces is not allowed') });

      const table = await call('POST', '/api/schema/keyspaces/ks/tables', {
        name: 'u',
        columns: [{ name: 'k', type: 'int', kind: 'partition_key' }],
        ifNotExists: false,
      });
      expect(table.status).toBe(403);
      expect(table.json.message).toContain('Creating tables is not allowed');
      expect(execute).not.toHaveBeenCalled();

      expect((await call('GET', '/api/schema/keyspaces')).status).toBe(200);
    });
  });

  describe('connected with a writable profile', () => {
    beforeEach(() => connectAs({ read_only: false }));

    it('reports it in the connection status', async () => {
      const { json } = await call('GET', '/api/profiles/status');
      expect(json.data.readOnly).toBe(false);
    });

    it('runs writes from the CQL editor', async () => {
      const { status, json } = await cql("INSERT INTO ks.t (k, v) VALUES (1, 'a')");
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(executed()).toEqual(["INSERT INTO ks.t (k, v) VALUES (1, 'a')"]);
    });

    it('inserts rows', async () => {
      const { status } = await call('POST', '/api/data/ks/t/rows/insert', { values: { k: 1, v: 'a' } });
      expect(status).toBe(200);
      expect(executed().some((q) => q.startsWith('INSERT INTO "ks"."t"'))).toBe(true);
    });
  });

  it('reports a disconnected tab as not read-only', async () => {
    const { json } = await call('GET', '/api/profiles/status');
    expect(json.data).toEqual({ connected: false, profileName: null, keyspace: null, readOnly: false });
  });
});
