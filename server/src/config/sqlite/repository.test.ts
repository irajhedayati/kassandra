import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { describeRepositoryContract } from '../repository.contract.js';
import { SqliteRepository } from './repository.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-sqlite-'));

describeRepositoryContract('SqliteRepository', () => {
  const dir = tmp();
  const repository = new SqliteRepository(path.join(dir, 'nested', 'kassandra.db'));
  return {
    repository,
    cleanup: () => {
      repository.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
});

describe('SqliteRepository', () => {
  const withDb = async (fn: (file: string, dir: string) => Promise<void> | void) => {
    const dir = tmp();
    try {
      await fn(path.join(dir, 'k.db'), dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('creates the relational tables with their foreign keys from the SQL migrations', () =>
    withDb(async (file) => {
      const repo = new SqliteRepository(file);
      expect(await repo.migrate()).toEqual(['0000_init']);
      expect(await repo.migrate()).toEqual([]);
      repo.close();
      const db = new Database(file, { readonly: true });
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%drizzle%' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
      expect(tables.sort()).toEqual(
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
      const fks = (table: string) => (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string; on_delete: string }[]);
      expect(fks('favorite_keyspaces')).toMatchObject([{ table: 'connections', on_delete: 'CASCADE' }]);
      expect(fks('app_state')).toMatchObject([{ table: 'connections', on_delete: 'SET NULL' }]);
      expect(fks('column_metadata')).toMatchObject([{ table: 'table_metadata', on_delete: 'CASCADE' }]);
      db.close();
    }));

  it('cascades a connection delete through every dependent table', () =>
    withDb(async (file) => {
      const repo = new SqliteRepository(file);
      await repo.migrate();
      const p = { ...DEFAULT_PROFILE, name: 'p' };
      await repo.upsertProfile(p);
      await repo.addFavoriteKeyspace('p', 'ks');
      await repo.replaceTableMetadata(
        { connection: 'p', keyspace: 'ks', table: 't' },
        { c: { enum_values: ['a'], map_schema: [{ key: 'k', label: 'K', enum_values: ['1'] }] } },
      );
      await repo.deleteProfile('p');
      repo.close();
      const db = new Database(file, { readonly: true });
      for (const t of ['connection_hosts', 'favorite_keyspaces', 'table_metadata', 'column_metadata', 'column_enum_values', 'column_map_entries', 'map_entry_enum_values']) {
        expect((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0);
      }
      db.close();
    }));

  it('enforces uniqueness and the single-row tables in the database itself', () =>
    withDb(async (file) => {
      const repo = new SqliteRepository(file);
      await repo.migrate();
      repo.close();
      const db = new Database(file);
      db.pragma('foreign_keys = ON');
      db.prepare("INSERT INTO saved_queries (id, name, query, position) VALUES ('1', 'n', 'q', 0)").run();
      expect(() => db.prepare("INSERT INTO saved_queries (id, name, query, position) VALUES ('2', 'n', 'q', 1)").run()).toThrow(/UNIQUE/);
      expect(() => db.prepare('INSERT INTO app_state (id) VALUES (2)').run()).toThrow(/CHECK/);
      expect(() => db.prepare("INSERT INTO favorite_keyspaces (connection_name, keyspace, position) VALUES ('ghost', 'k', 0)").run()).toThrow(/FOREIGN KEY/);
      db.close();
    }));

  it('persists across instances and shares the lock between them', () =>
    withDb(async (file) => {
      const a = new SqliteRepository(file);
      await a.migrate();
      const b = new SqliteRepository(file);
      try {
        await a.createSavedQuery({ name: 'q', description: '', query: 'SELECT 1', paramTypes: {} });
        expect((await b.listSavedQueries()).map((q) => q.name)).toEqual(['q']);
        const release = await a.lock();
        await expect(b.lock({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
        await release();
      } finally {
        a.close();
        b.close();
      }
    }));

  it('refuses a database migrated by a newer Kassandra', () =>
    withDb(async (file) => {
      const repo = new SqliteRepository(file);
      await repo.migrate();
      repo.close();
      const db = new Database(file);
      db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)").run();
      db.close();
      const again = new SqliteRepository(file);
      await expect(again.migrate()).rejects.toThrow(/newer than this version/);
      again.close();
    }));

  it('rejects a file that is not a database', () =>
    withDb(async (file) => {
      fs.writeFileSync(file, 'this is not a database file at all, just some plain text');
      expect(() => new SqliteRepository(file)).toThrow();
    }));

  it('rolls a failed operation back completely', () =>
    withDb(async (file) => {
      const repo = new SqliteRepository(file);
      await repo.migrate();
      await expect(repo.setColumnMetadata({ connection: 'ghost', keyspace: 'k', table: 't' }, 'c', { hide: true })).rejects.toThrow(/Unknown connection/);
      expect(await repo.listTables()).toEqual([]);
      repo.close();
    }));
});
