/**
 * Behaviour every ConfigRepository must have. A backend's test file calls
 * describeRepositoryContract() with a factory for a fresh, empty, not yet
 * migrated repository; the suite migrates it before each test.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, type ColumnMetadata, type ConnectionProfile } from '@kassandra/shared';
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

      it("deleting a profile removes its favorites and table metadata, and only its own", () =>
        withRepository(async (r) => {
          for (const n of ['c1', 'c1-x']) {
            await r.upsertProfile(profile(n));
            await r.addFavoriteKeyspace(n, 'ks');
            await r.setColumnMetadata(ref(n), 'a', { hide: true });
          }
          await r.deleteProfile('c1');
          expect(await r.getProfile('c1')).toBeNull();
          expect(await r.getFavoriteKeyspaces('c1')).toEqual([]);
          expect(await r.getTableMetadata(ref('c1'))).toEqual({});
          expect(await r.getFavoriteKeyspaces('c1-x')).toEqual(['ks']);
          expect(await r.getTableMetadata(ref('c1-x'))).toEqual({ a: { hide: true } });
          expect((await r.listTables()).map((t) => t.connection)).toEqual(['c1-x']);
        }));

      it('keeps favorites and metadata when a profile is updated', () =>
        withRepository(async (r) => {
          await r.upsertProfile(profile('p'));
          await r.addFavoriteKeyspace('p', 'ks');
          await r.setColumnMetadata(ref('p'), 'a', { hide: true });
          await r.upsertProfile(profile('p', { port: 1 }));
          expect(await r.getFavoriteKeyspaces('p')).toEqual(['ks']);
          expect(await r.getTableMetadata(ref('p'))).toEqual({ a: { hide: true } });
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
          const snapshot = await r.exportSnapshot();
          expect(snapshot.settings.saved_queries).toEqual([q]);
          expect(snapshot.version).not.toBeNull();

          const other = await create();
          try {
            await other.repository.migrate();
            await other.repository.importSnapshot(snapshot);
            const copy = await other.repository.exportSnapshot();
            expect(copy).toEqual(snapshot);
            expect(await other.repository.isEmpty()).toBe(false);
          } finally {
            await other.cleanup();
          }
        }));

      it('skips favorites and tables of connections that do not exist', () =>
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
          });
          expect(await r.getLastConnection()).toBe('');
          expect(await r.getFavoriteKeyspaces('a')).toEqual(['k']);
          expect((await r.listTables()).map((t) => t.connection)).toEqual(['a']);
        }));
    });
  });
}
