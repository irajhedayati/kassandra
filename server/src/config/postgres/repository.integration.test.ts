/**
 * PostgresRepository against a real PostgreSQL. Run with
 * `npm run test:integration -w @kassandra/server`, which starts a throwaway
 * container and sets KASSANDRA_TEST_PG_URL; plain `npm test` skips these files.
 *
 * Every test works in its own PostgreSQL schema, dropped afterwards, so tests
 * neither see each other's data nor need an empty database.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { describeRepositoryContract } from '../repository.contract.js';
import { PostgresRepository } from './repository.js';

const url = process.env.KASSANDRA_TEST_PG_URL;
if (!url) {
  throw new Error('KASSANDRA_TEST_PG_URL is not set; run `npm run test:integration -w @kassandra/server`');
}

const admin = new pg.Pool({ connectionString: url, max: 2 });
afterAll(() => admin.end());

const newSchema = () => `kassandra_test_${crypto.randomBytes(6).toString('hex')}`;
const dropSchema = (schema: string) => admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);

describeRepositoryContract('PostgresRepository', () => {
  const schema = newSchema();
  const repository = new PostgresRepository(url, { schema });
  return {
    repository,
    cleanup: async () => {
      await repository.destroy();
      await dropSchema(schema);
    },
  };
});

describe('PostgresRepository', () => {
  const withSchema = async (fn: (schema: string) => Promise<void>) => {
    const schema = newSchema();
    try {
      await fn(schema);
    } finally {
      await dropSchema(schema);
    }
  };

  /** Run `fn` on a migrated repository in a fresh schema, closing it afterwards. */
  const withRepository = (fn: (repo: PostgresRepository, schema: string) => Promise<void>) =>
    withSchema(async (schema) => {
      const repo = new PostgresRepository(url, { schema });
      try {
        await repo.migrate();
        await fn(repo, schema);
      } finally {
        await repo.destroy();
      }
    });

  const q = (schema: string, sql: string, params: unknown[] = []) => admin.query(sql.replaceAll('{s}', `"${schema}"`), params);

  it('creates the relational tables with their foreign keys from the migrations', () =>
    withSchema(async (schema) => {
      const repo = new PostgresRepository(url, { schema });
      try {
        expect(await repo.migrate()).toEqual(['0000_init']);
        expect(await repo.migrate()).toEqual([]);
      } finally {
        await repo.destroy();
      }
      const tables = await admin.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name NOT LIKE 'kysely_%'",
        [schema],
      );
      expect(tables.rows.map((t) => t.table_name).sort()).toEqual(
        [
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
        ].sort(),
      );
      const fks = async (table: string) =>
        (
          await admin.query<{ ref: string; on_delete: string }>(
            `SELECT (SELECT relname FROM pg_class WHERE oid = confrelid) AS ref, confdeltype AS on_delete
             FROM pg_constraint
             WHERE contype = 'f' AND connamespace = $1::regnamespace AND conrelid = ($1 || '.' || $2)::regclass`,
            [`"${schema}"`, `"${table}"`],
          )
        ).rows;
      expect(await fks('favorite_keyspaces')).toEqual([{ ref: 'connections', on_delete: 'c' }]);
      expect(await fks('app_state')).toEqual([{ ref: 'connections', on_delete: 'n' }]);
      expect(await fks('column_metadata')).toEqual([{ ref: 'table_metadata', on_delete: 'c' }]);
    }));

  it('cascades a connection delete through every dependent table', () =>
    withRepository(async (repo, schema) => {
      await repo.upsertProfile({ ...DEFAULT_PROFILE, name: 'p' });
      await repo.addFavoriteKeyspace('p', 'ks');
      await repo.replaceTableMetadata(
        { connection: 'p', keyspace: 'ks', table: 't' },
        { c: { enum_values: ['a'], map_schema: [{ key: 'k', label: 'K', enum_values: ['1'] }] } },
      );
      for (const t of ['connection_hosts', 'favorite_keyspaces', 'table_metadata', 'column_metadata', 'column_enum_values', 'column_map_entries', 'map_entry_enum_values']) {
        expect((await q(schema, `SELECT count(*)::int AS n FROM {s}.${t}`)).rows[0].n, `${t} before`).toBeGreaterThan(0);
      }
      await repo.deleteProfile('p');
      for (const t of ['connection_hosts', 'favorite_keyspaces', 'table_metadata', 'column_metadata', 'column_enum_values', 'column_map_entries', 'map_entry_enum_values']) {
        expect((await q(schema, `SELECT count(*)::int AS n FROM {s}.${t}`)).rows[0].n, t).toBe(0);
      }
    }));

  it('enforces uniqueness and the single-row tables in the database itself', () =>
    withRepository(async (repo, schema) => {
      await q(schema, "INSERT INTO {s}.saved_queries (id, name, query, position) VALUES ('1', 'n', 'q', 0)");
      await expect(q(schema, "INSERT INTO {s}.saved_queries (id, name, query, position) VALUES ('2', 'n', 'q', 1)")).rejects.toMatchObject({ code: '23505' });
      await expect(q(schema, 'INSERT INTO {s}.app_state (id) VALUES (2)')).rejects.toMatchObject({ code: '23514' });
      await expect(q(schema, "INSERT INTO {s}.lock (id, owner, taken_at) VALUES (2, 'o', 0)")).rejects.toMatchObject({ code: '23514' });
      await expect(q(schema, "INSERT INTO {s}.favorite_keyspaces (connection_name, keyspace, position) VALUES ('ghost', 'k', 0)")).rejects.toMatchObject({ code: '23503' });
      expect(await repo.listSavedQueries()).toHaveLength(1);
    }));

  it('persists across instances and shares the lock between them', () =>
    withRepository(async (a, schema) => {
      const b = new PostgresRepository(url, { schema });
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

  it('keeps schemas of the same database apart', () =>
    withRepository(async (a) => {
      await withRepository(async (b) => {
        await a.upsertProfile({ ...DEFAULT_PROFILE, name: 'only-in-a' });
        expect(await b.listProfiles()).toEqual([]);
        expect(await b.isEmpty()).toBe(true);
      });
    }));

  it('refuses a database migrated by a newer Kassandra', () =>
    withRepository(async (repo, schema) => {
      await q(schema, "INSERT INTO {s}.kysely_migration (name, timestamp) VALUES ('9999_future', '2099-01-01T00:00:00.000Z')");
      await expect(repo.migrate()).rejects.toThrow(/newer than this version/);
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
          connections: [{ ...DEFAULT_PROFILE, name: 'p' }],
          last_connection_name: 'p',
          favorite_keyspaces: {},
          saved_queries: [query, { ...query, name: 'b' }], // same id twice: the second insert fails
        },
        tables: [],
      };
      await expect(repo.importSnapshot(snapshot)).rejects.toThrow();
      expect(await repo.isEmpty()).toBe(true);
    }));

  it('rejects an invalid schema name before touching the database', () => {
    expect(() => new PostgresRepository(url, { schema: 'public"; DROP TABLE x; --' })).toThrow(/Invalid PostgreSQL schema name/);
  });

  it('fails clearly when the server cannot be reached, without leaking the credentials', async () => {
    const repo = new PostgresRepository('postgres://user:secret@127.0.0.1:1/nope');
    try {
      expect(repo.description).not.toContain('secret');
      await expect(repo.migrate()).rejects.toThrow();
    } finally {
      await repo.destroy();
    }
  });
});
