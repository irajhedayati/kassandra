/**
 * Behaviour every ConfigRepository must have. A backend's test file calls
 * describeRepositoryContract() with a factory for a fresh, empty, not yet
 * migrated repository; the suite migrates it before each test.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  type ColumnMetadata,
  type ConnectionProfile,
  type QueryHistoryEntry,
  type QueryHistoryInput,
} from '@kassandra/shared';
import type { ConfigRepository, TableRef } from './repository.js';

export interface RepositoryHarness {
  repository: ConfigRepository;
  cleanup(): Promise<void> | void;
}

const profile = (name: string, extra: Partial<ConnectionProfile> = {}): ConnectionProfile => ({
  ...DEFAULT_PROFILE,
  name,
  ...extra,
});
const ref = (connection: string, table = 't', keyspace = 'ks'): TableRef => ({ connection, keyspace, table });
const query = (name: string, extra = {}) => ({
  name,
  description: `about ${name}`,
  query: 'SELECT * FROM t WHERE id = :id',
  paramTypes: { id: 'uuid' },
  ...extra,
});
/** A history entry for `profile` that started `minute` minutes into 2026-01-01 UTC. */
const run = (profile: string, minute: number, extra: Partial<QueryHistoryInput> = {}): QueryHistoryInput => ({
  profile,
  query: `SELECT * FROM t${minute}`,
  params: [],
  started_at: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  duration_ms: 5,
  statements: 1,
  outcome: 'success',
  error: null,
  ...extra,
});
const queries = (entries: QueryHistoryEntry[]) => entries.map((e) => e.query);

/** Run `fn` with KASSANDRA_HISTORY_LIMIT set to `limit`, restoring it afterwards. */
async function withHistoryLimit(limit: string, fn: () => Promise<void>): Promise<void> {
  const before = process.env.KASSANDRA_HISTORY_LIMIT;
  process.env.KASSANDRA_HISTORY_LIMIT = limit;
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.KASSANDRA_HISTORY_LIMIT;
    else process.env.KASSANDRA_HISTORY_LIMIT = before;
  }
}

export function describeRepositoryContract(
  name: string,
  create: () => Promise<RepositoryHarness> | RepositoryHarness,
): void {
  describe(`ConfigRepository contract: ${name}`, () => {
    const withRepository = async (fn: (r: ConfigRepository) => Promise<void>) => {
      const h = await create();
      try {
        await h.repository.migrate();
        await fn(h.repository);
      } finally {
        await h.cleanup();
      }
    };

    describe('lifecycle', () => {
      it('is empty and versioned once migrated', () =>
        withRepository(async (r) => {
          expect(await r.isEmpty()).toBe(true);
          expect(await r.getVersion()).not.toBeNull();
          expect(await r.listProfiles()).toEqual([]);
          expect(await r.listSavedQueries()).toEqual([]);
          expect(await r.listTables()).toEqual([]);
          expect(await r.getLastConnection()).toBe('');
        }));

      it('can be migrated again without changing anything', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          const version = await r.getVersion();
          expect(await r.migrate()).toEqual([]);
          expect((await r.listProfiles()).map((p) => p.name)).toEqual(['p']);
          expect(await r.getVersion()).toBe(version);
        }));

      it('is no longer empty once anything is stored', () =>
        withRepository(async (r) => {
          await r.createSavedQuery(query('q'));
          expect(await r.isEmpty()).toBe(false);
        }));

      it('locks exclusively until released', () =>
        withRepository(async (r) => {
          const release = await r.lock();
          await expect(r.lock({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
          await release();
          await (await r.lock({ timeoutMs: 300 }))();
        }));

      it('waits for the holder to release', () =>
        withRepository(async (r) => {
          const release = await r.lock();
          setTimeout(() => void release(), 150);
          await (await r.lock({ timeoutMs: 3000 }))();
        }));

      it('takes over a stale lock', () =>
        withRepository(async (r) => {
          await r.lock();
          await (await r.lock({ timeoutMs: 3000, staleMs: 50 }))();
        }));
    });

    describe('connection profiles', () => {
      it('round-trips every field, including the order of the hosts', () =>
        withRepository(async (r) => {
          const full = profile('prod', {
            hosts: ['10.0.0.3', '10.0.0.1', '10.0.0.2'],
            port: 9142,
            username: 'u',
            password: 'p',
            ssl_enabled: true,
            ssl_protocol: 'PROTOCOL_TLSv1_2',
            ssl_cert_path: '/certs/ca.pem',
            default_keyspace: 'app',
            consistency_level: 'QUORUM',
            connection_timeout: 12,
            protocol_version: 4,
            local_datacenter: 'dc1',
            read_only: true,
          });
          await r.upsertProfile(full);
          expect(await r.getProfile('prod')).toEqual(full);
          expect(await r.listProfiles()).toEqual([full]);
          expect(await r.getProfile('nope')).toBeNull();
        }));

      it('lists profiles in creation order and updates in place', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('b'));
          await r.upsertProfile(profile('a'));
          await r.upsertProfile(profile('b', { port: 1234, hosts: ['h1', 'h2'] }));
          const all = await r.listProfiles();
          expect(all.map((p) => p.name)).toEqual(['b', 'a']);
          expect(all[0]).toMatchObject({ port: 1234, hosts: ['h1', 'h2'] });
        }));

      it('defaults the hosts when there are none', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p', { hosts: [] }));
          expect((await r.getProfile('p'))!.hosts).toEqual(['127.0.0.1']);
        }));

      it('tracks the last connection and clears it when that profile is deleted', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('a'));
          await r.upsertProfile(profile('b'));
          await r.setLastConnection('a');
          expect(await r.getLastConnection()).toBe('a');
          await r.deleteProfile('b');
          expect(await r.getLastConnection()).toBe('a');
          await r.deleteProfile('a');
          expect(await r.getLastConnection()).toBe('');
          await r.setLastConnection('');
          expect(await r.getLastConnection()).toBe('');
        }));

      it("deleting a profile removes its favorites, table metadata and history, and only its own", () =>
        withRepository(async (r) => {
          for (const n of ['c1', 'c1-x']) {
            await r.upsertProfile(profile(n));
            await r.addFavoriteKeyspace(n, 'ks');
            await r.setColumnMetadata(ref(n), 'a', { hide: true });
            await r.addHistoryEntry(run(n, 1, { params: [{ name: 'id', type: 'int', value: '1' }] }));
          }
          await r.deleteProfile('c1');
          expect(await r.getProfile('c1')).toBeNull();
          expect(await r.getFavoriteKeyspaces('c1')).toEqual([]);
          expect(await r.getTableMetadata(ref('c1'))).toEqual({});
          expect((await r.listHistory('c1')).entries).toEqual([]);
          expect(await r.getFavoriteKeyspaces('c1-x')).toEqual(['ks']);
          expect(await r.getTableMetadata(ref('c1-x'))).toEqual({ a: { hide: true } });
          expect((await r.listTables()).map((t) => t.connection)).toEqual(['c1-x']);
          expect(queries((await r.listHistory('c1-x')).entries)).toEqual(['SELECT * FROM t1']);

          // A profile created again under the same name starts with no history.
          await r.upsertProfile(profile('c1'));
          expect((await r.listHistory('c1')).entries).toEqual([]);
        }));

      it('keeps favorites, metadata and history when a profile is updated', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.addFavoriteKeyspace('p', 'ks');
          await r.setColumnMetadata(ref('p'), 'a', { hide: true });
          const entry = await r.addHistoryEntry(run('p', 1));
          await r.upsertProfile(profile('p', { port: 1 }));
          expect(await r.getFavoriteKeyspaces('p')).toEqual(['ks']);
          expect(await r.getTableMetadata(ref('p'))).toEqual({ a: { hide: true } });
          expect((await r.listHistory('p')).entries).toEqual([entry]);
        }));
    });

    describe('favorite keyspaces', () => {
      it('adds in order, ignores duplicates, and removes', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.upsertProfile(profile('q'));
          expect(await r.getFavoriteKeyspaces('p')).toEqual([]);
          expect(await r.addFavoriteKeyspace('p', 'zeta')).toEqual(['zeta']);
          expect(await r.addFavoriteKeyspace('p', 'alpha')).toEqual(['zeta', 'alpha']);
          expect(await r.addFavoriteKeyspace('p', 'zeta')).toEqual(['zeta', 'alpha']);
          await r.addFavoriteKeyspace('q', 'other');
          expect(await r.removeFavoriteKeyspace('p', 'zeta')).toEqual(['alpha']);
          expect(await r.removeFavoriteKeyspace('p', 'missing')).toEqual(['alpha']);
          expect(await r.getFavoriteKeyspaces('q')).toEqual(['other']);
        }));
    });

    describe('saved queries', () => {
      it('creates, lists in order, updates and deletes', () =>
        withRepository(async (r) => {
          const a = await r.createSavedQuery(query('a'));
          const b = await r.createSavedQuery(query('b', { paramTypes: {} }));
          expect(a.id).not.toBe(b.id);
          expect(await r.listSavedQueries()).toEqual([a, b]);
          const updated = await r.updateSavedQuery(a.id, query('a2', { description: 'new', paramTypes: { x: 'int', y: 'text' } }));
          expect(updated).toEqual({ id: a.id, ...query('a2', { description: 'new', paramTypes: { x: 'int', y: 'text' } }) });
          expect(await r.listSavedQueries()).toEqual([updated, b]);
          await r.deleteSavedQuery(a.id);
          expect(await r.listSavedQueries()).toEqual([b]);
        }));

      it('rejects duplicate names and unknown ids with the right status', () =>
        withRepository(async (r) => {
          const a = await r.createSavedQuery(query('a'));
          const b = await r.createSavedQuery(query('b'));
          await expect(r.createSavedQuery(query('a'))).rejects.toMatchObject({ status: 409 });
          await expect(r.updateSavedQuery(b.id, query('a'))).rejects.toMatchObject({ status: 409 });
          await expect(r.updateSavedQuery('nope', query('c'))).rejects.toMatchObject({ status: 404 });
          await expect(r.deleteSavedQuery('nope')).rejects.toMatchObject({ status: 404 });
          await r.updateSavedQuery(a.id, query('a', { description: 'same name, same query is fine' }));
        }));

      it('imports by name, upserting existing queries and keeping their ids', () =>
        withRepository(async (r) => {
          const a = await r.createSavedQuery(query('a'));
          const result = await r.importSavedQueries([query('a', { query: 'SELECT 1' }), query('c')]);
          expect(result).toEqual({ created: 1, updated: 1 });
          const all = await r.listSavedQueries();
          expect(all.map((q) => q.name)).toEqual(['a', 'c']);
          expect(all[0]).toMatchObject({ id: a.id, query: 'SELECT 1' });
        }));
    });

    describe('table metadata', () => {
      const rich: Record<string, ColumnMetadata> = {
        status: { display_type: 'enum', enum_values: ['new', 'open', 'closed'] },
        attrs: {
          display_type: 'map',
          map_schema: [
            { key: 'color', label: 'Colour', display_type: 'enum', enum_values: ['red', 'green'] },
            { key: 'note', label: 'Note' },
          ],
        },
        secret: { hide: true },
        shown: { hide: false },
        bare: {},
      };

      it('round-trips hide, display types, enum values and map schemas, in order', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.replaceTableMetadata(ref('p'), rich);
          expect(await r.getTableMetadata(ref('p'))).toEqual(rich);
        }));

      it('merges per column and keeps tables and connections apart', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('c1'));
          await r.upsertProfile(profile('c2'));
          await r.setColumnMetadata(ref('c1'), 'a', { hide: true });
          expect(await r.setColumnMetadata(ref('c1'), 'a', { display_type: 'JSON' })).toEqual({
            hide: true,
            display_type: 'JSON',
          });
          await r.setColumnMetadata(ref('c1'), 'b', { hide: false });
          expect(await r.getTableMetadata(ref('c1'))).toEqual({ a: { hide: true, display_type: 'JSON' }, b: { hide: false } });
          expect(await r.getTableMetadata(ref('c2'))).toEqual({});
          expect(await r.getTableMetadata(ref('c1', 'other'))).toEqual({});
        }));

      it('replaces a column wholesale when its nested lists change', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.setColumnMetadata(ref('p'), 'a', { enum_values: ['x', 'y'], map_schema: [{ key: 'k', label: 'K' }] });
          await r.setColumnMetadata(ref('p'), 'a', { enum_values: ['z'], map_schema: undefined });
          expect((await r.getTableMetadata(ref('p')))['a']).toEqual({ enum_values: ['z'] });
        }));

      it('replaces the whole table', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.replaceTableMetadata(ref('p'), { a: { hide: true }, b: { hide: true } });
          await r.replaceTableMetadata(ref('p'), { c: { hide: false } });
          expect(await r.getTableMetadata(ref('p'))).toEqual({ c: { hide: false } });
        }));

      it('lists tables that have metadata with their column counts, even when empty', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('dev'));
          await r.upsertProfile(profile('my cluster'));
          await r.replaceTableMetadata(ref('dev'), { a: {}, b: {} });
          await r.replaceTableMetadata(ref('my cluster', 'u', 'ks2'), {});
          const tables = (await r.listTables()).sort((a, b) => a.connection.localeCompare(b.connection));
          expect(tables).toEqual([
            { connection: 'dev', keyspace: 'ks', table: 't', columns: 2 },
            { connection: 'my cluster', keyspace: 'ks2', table: 'u', columns: 0 },
          ]);
        }));

      it('handles unusual names', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile("it's a-b.c"));
          const odd = { connection: "it's a-b.c", keyspace: 'k-s', table: 't.x' };
          await r.setColumnMetadata(odd, 'wéird "col"', { hide: true });
          expect(await r.getTableMetadata(odd)).toEqual({ 'wéird "col"': { hide: true } });
        }));
    });

    describe('query history', () => {
      it('records every field and assigns ids', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          const input = run('p', 1, {
            query: "SELECT * FROM t WHERE id = :id AND name = :name;\nUPDATE t SET a = 1 WHERE id = :id",
            params: [
              { name: 'name', type: 'text', value: "it's \"quoted\"" },
              { name: 'id', type: 'uuid', value: '7f3c1a52-08d4-4f0e-9a3a-0a3c1b5f9e11' },
            ],
            started_at: '2026-03-04T05:06:07.089+02:00',
            duration_ms: 1234,
            statements: 2,
            outcome: 'partial',
            error: 'Invalid column name a',
          });
          const a = await r.addHistoryEntry(input);
          const b = await r.addHistoryEntry(run('p', 2, { outcome: 'failed', error: 'boom' }));
          expect(a.id).toEqual(expect.any(String));
          expect(a.id).not.toBe(b.id);
          // started_at is normalized to UTC.
          expect(a).toEqual({ ...input, id: a.id, started_at: '2026-03-04T03:06:07.089Z' });
          expect((await r.listHistory('p')).entries).toEqual([a, b]);
        }));

      it('lists newest first whatever the insertion order, per profile', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.upsertProfile(profile('q'));
          for (const minute of [3, 1, 4, 2]) await r.addHistoryEntry(run('p', minute));
          await r.addHistoryEntry(run('q', 9));
          expect(queries((await r.listHistory('p')).entries)).toEqual([
            'SELECT * FROM t4',
            'SELECT * FROM t3',
            'SELECT * FROM t2',
            'SELECT * FROM t1',
          ]);
          expect(queries((await r.listHistory('q')).entries)).toEqual(['SELECT * FROM t9']);
          expect(await r.listHistory('nobody')).toEqual({ entries: [], next_cursor: null });
        }));

      it('orders entries that started at the same time by descending id', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          const same = [];
          for (let i = 0; i < 4; i++) same.push(await r.addHistoryEntry(run('p', 1, { query: `q${i}` })));
          const ids = (await r.listHistory('p')).entries.map((e) => e.id);
          expect(ids).toEqual(same.map((e) => e.id).sort().reverse());
          // ... and pages through them without skipping or repeating any.
          const first = await r.listHistory('p', { limit: 2 });
          const second = await r.listHistory('p', { limit: 2, cursor: first.next_cursor });
          expect([...first.entries, ...second.entries].map((e) => e.id)).toEqual(ids);
        }));

      it('keeps only the newest KASSANDRA_HISTORY_LIMIT entries per profile', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.upsertProfile(profile('q'));
          await withHistoryLimit('3', async () => {
            for (const minute of [5, 1, 4]) await r.addHistoryEntry(run('p', minute));
            await r.addHistoryEntry(run('q', 0));
            await r.addHistoryEntry(run('p', 2, { params: [{ name: 'x', type: 'int', value: '1' }] })); // drops t1
            await r.addHistoryEntry(run('p', 6)); // drops t2 (and its parameters)
            expect(queries((await r.listHistory('p')).entries)).toEqual([
              'SELECT * FROM t6',
              'SELECT * FROM t5',
              'SELECT * FROM t4',
            ]);
            // An entry older than everything kept is dropped straight away.
            await r.addHistoryEntry(run('p', 0));
            expect((await r.listHistory('p')).entries).toHaveLength(3);
            expect(queries((await r.listHistory('q')).entries)).toEqual(['SELECT * FROM t0']);
          });
        }));

      it('caps at 200 entries by default', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await withHistoryLimit('', async () => {
            for (let minute = 0; minute < 201; minute++) await r.addHistoryEntry(run('p', minute));
          });
          const page = await r.listHistory('p', { limit: 500 });
          expect(page.entries).toHaveLength(200);
          expect(page.entries.at(-1)!.query).toBe('SELECT * FROM t1');
        }));

      it('pages with a cursor', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          for (let minute = 1; minute <= 5; minute++) await r.addHistoryEntry(run('p', minute));
          const first = await r.listHistory('p', { limit: 2 });
          expect(queries(first.entries)).toEqual(['SELECT * FROM t5', 'SELECT * FROM t4']);
          expect(first.next_cursor).toEqual(expect.any(String));
          const second = await r.listHistory('p', { limit: 2, cursor: first.next_cursor });
          expect(queries(second.entries)).toEqual(['SELECT * FROM t3', 'SELECT * FROM t2']);
          const third = await r.listHistory('p', { limit: 2, cursor: second.next_cursor });
          expect(queries(third.entries)).toEqual(['SELECT * FROM t1']);
          expect(third.next_cursor).toBeNull();
          // A page that ends exactly on the last entry has no next page either.
          expect((await r.listHistory('p', { limit: 5 })).next_cursor).toBeNull();
          // Entries added since do not shift the pages that follow a cursor.
          await r.addHistoryEntry(run('p', 9));
          expect(queries((await r.listHistory('p', { limit: 2, cursor: first.next_cursor })).entries)).toEqual([
            'SELECT * FROM t3',
            'SELECT * FROM t2',
          ]);
          // The default page size is 50.
          for (let minute = 10; minute < 70; minute++) await r.addHistoryEntry(run('p', minute));
          expect((await r.listHistory('p')).entries).toHaveLength(50);
        }));

      it('rejects a cursor it did not hand out', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await expect(r.listHistory('p', { cursor: 'not a cursor' })).rejects.toMatchObject({ status: 400 });
          await expect(
            r.listHistory('p', { cursor: Buffer.from('{"a":1}').toString('base64url') }),
          ).rejects.toMatchObject({ status: 400 });
        }));

      it('searches the query text, ignoring case and taking wildcards literally', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.upsertProfile(profile('q'));
          const texts = [
            'SELECT * FROM users',
            "select name from Users where name = '50%_off'",
            'INSERT INTO orders (id) VALUES (1)',
            'SELECT * FROM user_roles',
            'SELECT * FROM userXroles',
            "SELECT * FROM t WHERE city = 'ÉVORA'",
            'SELECT 1 FROM t WHERE a!b = 1',
          ];
          for (const [minute, query] of texts.entries()) await r.addHistoryEntry(run('p', minute, { query }));
          await r.addHistoryEntry(run('q', 0, { query: 'SELECT * FROM users' }));
          const search = async (term: string, limit?: number) =>
            queries((await r.listHistory('p', { search: term, limit })).entries);

          expect(await search('USERS')).toEqual([texts[1], texts[0]]);
          expect(await search('user_')).toEqual([texts[3]]);
          expect(await search('50%_')).toEqual([texts[1]]);
          expect(await search('%')).toEqual([texts[1]]);
          expect(await search('a!b')).toEqual([texts[6]]);
          expect(await search('évora')).toEqual([texts[5]]);
          expect(await search('nothing like it')).toEqual([]);
          expect(await search('')).toHaveLength(texts.length);

          // Paging within the results.
          const first = await r.listHistory('p', { search: 'select', limit: 2 });
          expect(queries(first.entries)).toEqual([texts[6], texts[5]]);
          const rest = await r.listHistory('p', { search: 'select', limit: 10, cursor: first.next_cursor });
          expect(queries(rest.entries)).toEqual([texts[4], texts[3], texts[1], texts[0]]);
          expect(rest.next_cursor).toBeNull();
        }));

      it('deletes one entry of a profile', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.upsertProfile(profile('q'));
          const a = await r.addHistoryEntry(run('p', 1, { params: [{ name: 'x', type: 'int', value: '1' }] }));
          const b = await r.addHistoryEntry(run('p', 2));
          const other = await r.addHistoryEntry(run('q', 3));
          await r.deleteHistoryEntry('p', a.id);
          expect((await r.listHistory('p')).entries).toEqual([b]);
          await expect(r.deleteHistoryEntry('p', a.id)).rejects.toMatchObject({ status: 404 });
          await expect(r.deleteHistoryEntry('p', other.id)).rejects.toMatchObject({ status: 404 });
          expect((await r.listHistory('q')).entries).toEqual([other]);
          await r.deleteHistoryEntry('p', b.id);
          expect((await r.listHistory('p')).entries).toEqual([]);
        }));

      it("clears a profile's history and only its own", () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.upsertProfile(profile('q'));
          await r.addHistoryEntry(run('p', 1, { params: [{ name: 'x', type: 'int', value: '1' }] }));
          await r.addHistoryEntry(run('p', 2));
          await r.addHistoryEntry(run('q', 3));
          await r.clearHistory('p');
          expect((await r.listHistory('p')).entries).toEqual([]);
          expect(queries((await r.listHistory('q')).entries)).toEqual(['SELECT * FROM t3']);
          await r.clearHistory('p');
          await r.clearHistory('nobody');
          await r.addHistoryEntry(run('p', 4));
          expect(queries((await r.listHistory('p')).entries)).toEqual(['SELECT * FROM t4']);
        }));

      it('rejects entries for unknown profiles and unparseable start times', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await expect(r.addHistoryEntry(run('ghost', 1))).rejects.toMatchObject({ status: 404 });
          await expect(r.addHistoryEntry(run('p', 1, { started_at: 'yesterday' }))).rejects.toMatchObject({ status: 400 });
          expect((await r.listHistory('p')).entries).toEqual([]);
          expect((await r.listHistory('ghost')).entries).toEqual([]);
        }));

      it('handles unusual profile names', () =>
        withRepository(async (r) => {
          const odd = "it's a-b.c/d é";
          await r.upsertProfile(profile(odd));
          const entry = await r.addHistoryEntry(run(odd, 1));
          expect((await r.listHistory(odd)).entries).toEqual([entry]);
          await r.deleteProfile(odd);
          expect((await r.listHistory(odd)).entries).toEqual([]);
        }));
    });

    describe('snapshots', () => {
      it('copies everything to another repository, including ids, order and nested metadata', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('a', { hosts: ['h1', 'h2'], port: 1 }));
          await r.upsertProfile(profile('b'));
          await r.setLastConnection('b');
          await r.addFavoriteKeyspace('a', 'k2');
          await r.addFavoriteKeyspace('a', 'k1');
          const q = await r.createSavedQuery(query('q'));
          await r.replaceTableMetadata(ref('a'), {
            status: { enum_values: ['x', 'y'] },
            m: { map_schema: [{ key: 'k', label: 'K', enum_values: ['1'] }] },
          });
          const h1 = await r.addHistoryEntry(run('a', 1, { params: [{ name: 'id', type: 'int', value: '7' }] }));
          const h2 = await r.addHistoryEntry(run('a', 2, { outcome: 'failed', error: 'nope' }));
          const h3 = await r.addHistoryEntry(run('b', 3));
          const snapshot = await r.exportSnapshot();
          expect(snapshot.settings.saved_queries).toEqual([q]);
          expect(snapshot.history).toEqual([h2, h1, h3]);
          expect(snapshot.version).not.toBeNull();

          const other = await create();
          try {
            await other.repository.migrate();
            await other.repository.importSnapshot(snapshot);
            const copy = await other.repository.exportSnapshot();
            expect(copy).toEqual(snapshot);
            expect((await other.repository.listHistory('a')).entries).toEqual([h2, h1]);
            expect(await other.repository.isEmpty()).toBe(false);
          } finally {
            await other.cleanup();
          }
        }));

      it('skips favorites, tables and history of connections that do not exist', () =>
        withRepository(async (r) => {
          await r.importSnapshot({
            version: null,
            settings: {
              connections: [profile('a')],
              last_connection_name: 'ghost',
              favorite_keyspaces: { a: ['k'], ghost: ['x'] },
              saved_queries: [],
            },
            tables: [
              { ...ref('a'), columns: { c: { hide: true } } },
              { ...ref('ghost'), columns: { c: { hide: true } } },
            ],
            history: [
              { ...run('a', 1), id: 'h-a' },
              { ...run('ghost', 2), id: 'h-ghost' },
            ],
          });
          expect(await r.getLastConnection()).toBe('');
          expect((await r.listHistory('a')).entries.map((e) => e.id)).toEqual(['h-a']);
          expect((await r.exportSnapshot()).history.map((e) => e.id)).toEqual(['h-a']);
          expect(await r.getFavoriteKeyspaces('a')).toEqual(['k']);
          expect((await r.listTables()).map((t) => t.connection)).toEqual(['a']);
        }));
    });
  });
}
