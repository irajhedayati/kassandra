/**
 * SqlRepository against real PostgreSQL and MySQL servers. Run with
 * `npm run test:integration -w @kassandra/server`, which starts throwaway
 * containers and sets the KASSANDRA_TEST_*_URL variables; plain `npm test`
 * skips these files. See testing.ts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { describeRepositoryContract } from '../repository.contract.js';
import { SqlRepository } from './repository.js';
import { closeTestAdmins, createNamespace, isViolation, testTargets, type ViolationKind } from './testing.js';

afterAll(closeTestAdmins);

const TABLES = [
  'app_state',
  'column_enum_values',
  'column_map_entries',
  'column_metadata',
  'connection_hosts',
  'connections',
  'favorite_keyspaces',
  'lock',
  'map_entry_enum_values',
  'meta',
  'saved_queries',
  'saved_query_params',
  'table_metadata',
];

const profile = (name: string) => ({ ...DEFAULT_PROFILE, name });

for (const { dialect, url } of testTargets()) {
  describeRepositoryContract(`SqlRepository (${dialect})`, async () => {
    const ns = await createNamespace(dialect, url);
    const repository = new SqlRepository(ns.connection);
    return {
      repository,
      cleanup: async () => {
        await repository.destroy();
        await ns.drop();
      },
    };
  });

  describe(`SqlRepository (${dialect})`, () => {
    /** Run `fn` on a migrated repository in a fresh namespace, closing it afterwards. */
    const withRepository = async (fn: (repo: SqlRepository, ns: Awaited<ReturnType<typeof createNamespace>>) => Promise<void>) => {
      const ns = await createNamespace(dialect, url);
      const repo = new SqlRepository(ns.connection);
      try {
        await repo.migrate();
        await fn(repo, ns);
      } finally {
        await repo.destroy();
        await ns.drop();
      }
    };

    const expectViolation = async (statement: Promise<unknown>, kind: ViolationKind) => {
      const err = await statement.then(
        () => null,
        (e) => e,
      );
      expect(err, `expected a ${kind} violation`).not.toBeNull();
      expect(isViolation(err, kind), `${kind} violation, got ${err?.code}: ${err?.message}`).toBe(true);
    };

    it('creates the relational tables with their foreign keys from the migrations', async () => {
      const ns = await createNamespace(dialect, url);
      try {
        const repo = new SqlRepository(ns.connection);
        try {
          expect(await repo.migrate()).toEqual(['0000_init']);
          expect(await repo.migrate()).toEqual([]);
        } finally {
          await repo.destroy();
        }
        const tables = await ns.query(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' AND table_name NOT LIKE 'kysely%'",
          [dialect === 'postgres' ? ns.connection.schema : ns.connection.database],
        );
        expect(tables.map((t) => t.name).sort()).toEqual([...TABLES].sort());

        const foreignKeys = async (table: string) => {
          if (dialect === 'postgres') {
            const rows = await ns.query(
              `SELECT ref.relname AS ref, c.confdeltype AS rule FROM pg_constraint c
               JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class ref ON ref.oid = c.confrelid
               JOIN pg_namespace n ON n.oid = c.connamespace
               WHERE c.contype = 'f' AND n.nspname = ? AND cl.relname = ?`,
              [ns.connection.schema, table],
            );
            return rows.map((r) => ({ ref: r.ref, rule: r.rule === 'c' ? 'CASCADE' : r.rule === 'n' ? 'SET NULL' : r.rule }));
          }
          const rows = await ns.query(
            'SELECT referenced_table_name AS ref, delete_rule AS `rule` FROM information_schema.referential_constraints WHERE constraint_schema = ? AND table_name = ?',
            [ns.connection.database, table],
          );
          return rows.map((r) => ({ ref: r.ref, rule: r.rule }));
        };
        expect(await foreignKeys('favorite_keyspaces')).toEqual([{ ref: 'connections', rule: 'CASCADE' }]);
        expect(await foreignKeys('app_state')).toEqual([{ ref: 'connections', rule: 'SET NULL' }]);
        expect(await foreignKeys('column_metadata')).toEqual([{ ref: 'table_metadata', rule: 'CASCADE' }]);
      } finally {
        await ns.drop();
      }
    });

    it('cascades a connection delete through every dependent table', () =>
      withRepository(async (repo, ns) => {
        await repo.upsertProfile(profile('p'));
        await repo.addFavoriteKeyspace('p', 'ks');
        await repo.replaceTableMetadata(
          { connection: 'p', keyspace: 'ks', table: 't' },
          { c: { enum_values: ['a'], map_schema: [{ key: 'k', label: 'K', enum_values: ['1'] }] } },
        );
        const dependents = ['connection_hosts', 'favorite_keyspaces', 'table_metadata', 'column_metadata', 'column_enum_values', 'column_map_entries', 'map_entry_enum_values'];
        const count = async (t: string) => Number((await ns.query(`SELECT count(*) AS n FROM ${ns.ref(t)}`))[0]!.n);
        for (const t of dependents) expect(await count(t), `${t} before`).toBeGreaterThan(0);
        await repo.deleteProfile('p');
        for (const t of dependents) expect(await count(t), t).toBe(0);
      }));

    it('enforces uniqueness and the single-row tables in the database itself', () =>
      withRepository(async (repo, ns) => {
        await ns.query(`INSERT INTO ${ns.ref('saved_queries')} (id, name, description, query, position) VALUES ('1', 'n', '', 'q', 0)`);
        await expectViolation(
          ns.query(`INSERT INTO ${ns.ref('saved_queries')} (id, name, description, query, position) VALUES ('2', 'n', '', 'q', 1)`),
          'unique',
        );
        await expectViolation(ns.query(`INSERT INTO ${ns.ref('app_state')} (id) VALUES (2)`), 'check');
        await expectViolation(ns.query(`INSERT INTO ${ns.ref('lock')} (id, owner, taken_at) VALUES (2, 'o', 0)`), 'check');
        await expectViolation(
          ns.query(`INSERT INTO ${ns.ref('favorite_keyspaces')} (connection_name, keyspace, position) VALUES ('ghost', 'k', 0)`),
          'foreign key',
        );
        expect(await repo.listSavedQueries()).toHaveLength(1);
      }));

    it('keeps names case- and space-sensitive, and stores any unicode', () =>
      withRepository(async (repo) => {
        const names = ['prod', 'Prod', 'prod ', 'produção', 'données 🚀'];
        for (const name of names) await repo.upsertProfile(profile(name));
        expect((await repo.listProfiles()).map((p) => p.name)).toEqual(names);
        await repo.createSavedQuery({ name: 'q', description: '', query: 'SELECT 1', paramTypes: {} });
        await repo.createSavedQuery({ name: 'Q', description: '', query: 'SELECT 2', paramTypes: {} });
        expect((await repo.listSavedQueries()).map((q) => q.name)).toEqual(['q', 'Q']);
        await repo.addFavoriteKeyspace('prod', 'KS');
        await repo.addFavoriteKeyspace('prod', 'ks');
        expect(await repo.getFavoriteKeyspaces('prod')).toEqual(['KS', 'ks']);
        expect(await repo.getFavoriteKeyspaces('Prod')).toEqual([]);
      }));

    it('stores long text in full', () =>
      withRepository(async (repo) => {
        const query = `SELECT ${'x'.repeat(200_000)}`;
        const saved = await repo.createSavedQuery({ name: 'long', description: 'd'.repeat(5000), query, paramTypes: {} });
        expect((await repo.listSavedQueries())[0]).toEqual(saved);
      }));

    it('persists across instances and shares the lock between them', () =>
      withRepository(async (a, ns) => {
        const b = new SqlRepository(ns.connection);
        try {
          await a.createSavedQuery({ name: 'q', description: '', query: 'SELECT 1', paramTypes: {} });
          expect((await b.listSavedQueries()).map((x) => x.name)).toEqual(['q']);
          const release = await a.lock();
          await expect(b.lock({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
          await release();
          await (await b.lock({ timeoutMs: 300 }))();
        } finally {
          await b.destroy();
        }
      }));

    it('lets only one of several racing instances take the lock', () =>
      withRepository(async (a, ns) => {
        const others = [new SqlRepository(ns.connection), new SqlRepository(ns.connection), new SqlRepository(ns.connection)];
        try {
          const attempts = await Promise.allSettled([a, ...others].map((r) => r.lock({ timeoutMs: 400 })));
          expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
          expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(3);
        } finally {
          await Promise.all(others.map((r) => r.destroy()));
        }
      }));

    it('keeps namespaces of the same server apart', () =>
      withRepository(async (a) => {
        await withRepository(async (b) => {
          await a.upsertProfile(profile('only-in-a'));
          expect(await b.listProfiles()).toEqual([]);
          expect(await b.isEmpty()).toBe(true);
        });
      }));

    it('refuses a database migrated by a newer Kassandra', () =>
      withRepository(async (repo, ns) => {
        await ns.query(`INSERT INTO ${ns.ref('kysely_migration')} (name, timestamp) VALUES ('9999_future', '2099-01-01T00:00:00.000Z')`);
        await expect(repo.migrate()).rejects.toThrow(/newer than this version/);
      }));

    it('can rerun a migration that was only partly applied', () =>
      withRepository(async (repo, ns) => {
        // MySQL commits DDL as it goes, so a crash can leave some tables; recreate that state.
        await ns.query(`DELETE FROM ${ns.ref('kysely_migration')}`);
        await ns.query(`DROP TABLE ${ns.ref('lock')}`);
        expect(await repo.migrate()).toEqual(['0000_init']);
        await (await repo.lock())();
      }));

    it('rolls a failed operation back completely', () =>
      withRepository(async (repo) => {
        await expect(repo.setColumnMetadata({ connection: 'ghost', keyspace: 'k', table: 't' }, 'c', { hide: true })).rejects.toThrow(/Unknown connection/);
        expect(await repo.listTables()).toEqual([]);
      }));

    it('rolls back a snapshot import that fails halfway', () =>
      withRepository(async (repo) => {
        const query = { id: 'same', name: 'a', description: '', query: 'SELECT 1', paramTypes: {} };
        const snapshot = {
          version: '1.0.0',
          settings: {
            connections: [profile('p')],
            last_connection_name: 'p',
            favorite_keyspaces: {},
            saved_queries: [query, { ...query, name: 'b' }], // same id twice: the second insert fails
          },
          tables: [],
        };
        await expect(repo.importSnapshot(snapshot)).rejects.toThrow();
        expect(await repo.isEmpty()).toBe(true);
      }));

    it('rejects an invalid connection before touching the database', async () => {
      const ns = await createNamespace(dialect, url);
      try {
        expect(() => new SqlRepository({ ...ns.connection, port: 0 })).toThrow(/port/);
        expect(() => new SqlRepository({ ...ns.connection, database: '' })).toThrow(/database/);
        if (dialect === 'postgres') {
          expect(() => new SqlRepository({ ...ns.connection, schema: 'public"; DROP TABLE x; --' })).toThrow(/Invalid PostgreSQL schema name/);
        }
      } finally {
        await ns.drop();
      }
    });

    it('fails clearly when the server cannot be reached, without leaking the credentials', async () => {
      const repo = new SqlRepository({ dialect, host: '127.0.0.1', port: 1, database: 'nope', username: 'user', password: 'secret', ssl: false, schema: 'public' });
      try {
        expect(repo.description).not.toContain('secret');
        await expect(repo.migrate()).rejects.toThrow();
      } finally {
        await repo.destroy();
      }
    });
  });
}
