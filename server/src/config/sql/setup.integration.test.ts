/**
 * Switching the storage to PostgreSQL or MySQL from the Configuration page,
 * against real servers. See repository.integration.test.ts for how these are run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, type SqlConnectionRequest } from '@kassandra/shared';
import { getBackendName } from '../backend.js';
import { DocumentRepository } from '../documentRepository.js';
import { FileStorage } from '../fileStorage.js';
import { getRepository } from '../registry.js';
import { changeStorage, getSetupInfo } from '../setup.js';
import { closeSharedSqlRepository, SqlRepository } from './repository.js';
import { closeTestAdmins, createNamespace, testTargets, type TestNamespace } from './testing.js';

afterAll(closeTestAdmins);

for (const { dialect, url } of testTargets()) {
  describe(`switching the storage to ${dialect}`, () => {
    let home: string;
    let ns: TestNamespace;
    const savedHome = process.env.HOME;
    const t = { connection: 'p', keyspace: 'ks', table: 't' };

    beforeEach(async () => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
      process.env.HOME = home;
      for (const name of ['KASSANDRA_HOME', 'KASSANDRA_STORAGE', 'KASSANDRA_DB_URL', 'KASSANDRA_DB_SCHEMA']) delete process.env[name];
      ns = await createNamespace(dialect, url);
    });
    afterEach(async () => {
      closeSharedSqlRepository();
      process.env.HOME = savedHome;
      fs.rmSync(home, { recursive: true, force: true });
      await ns.drop();
    });

    /** The settings the Configuration page would send for the test namespace. */
    const settings = (extra: Partial<SqlConnectionRequest> = {}): SqlConnectionRequest => ({
      host: ns.connection.host,
      port: ns.connection.port,
      database: ns.connection.database,
      username: ns.connection.username,
      password: ns.connection.password,
      ssl: false,
      schema: ns.connection.schema,
      ...extra,
    });

    const seedFiles = async () => {
      const files = new DocumentRepository(new FileStorage(path.join(home, '.kassandra')));
      await files.migrate();
      await files.upsertProfile({ ...DEFAULT_PROFILE, name: 'p', hosts: ['h1', 'h2'] });
      await files.setColumnMetadata(t, 'c', { hide: true });
      await files.createSavedQuery({ name: 'q', description: '', query: 'SELECT 1', paramTypes: {} });
    };

    it('copies the JSON configuration into the database, uses it from then on and never exposes the password', async () => {
      await seedFiles();
      const result = await changeStorage({ backend: dialect, sql: settings() });
      expect(result).toMatchObject({
        backend: dialect,
        copied: 3,
        existing: false,
        sql: { dialect, host: ns.connection.host, database: ns.connection.database, username: ns.connection.username, hasPassword: ns.connection.password !== '' },
      });
      expect(result.sql).not.toHaveProperty('password');
      expect(JSON.stringify(result)).not.toContain('"password"');
      expect(getBackendName()).toBe(dialect);

      const active = getRepository();
      expect(active).toBeInstanceOf(SqlRepository);
      expect((await active.listProfiles()).map((p) => p.name)).toEqual(['p']);
      expect((await active.listSavedQueries()).map((q) => q.name)).toEqual(['q']);
      expect(await active.getTableMetadata(t)).toEqual({ c: { hide: true } });
    });

    it('keeps the saved password when none is sent, and treats the same settings as unchanged', async () => {
      await changeStorage({ backend: dialect, sql: settings() });
      const { password: _omitted, ...withoutPassword } = settings();
      const again = await changeStorage({ backend: dialect, sql: withoutPassword });
      expect(again).toMatchObject({ backend: dialect, copied: 0, existing: false });
      // Still connects, so the saved password was used.
      expect(await getRepository().isEmpty()).toBe(true);
      expect(getSetupInfo().sql.hasPassword).toBe(ns.connection.password !== '');
    });

    it('uses a database that already holds a configuration as is, without copying over it', async () => {
      const prepared = new SqlRepository(ns.connection);
      await prepared.migrate();
      await prepared.upsertProfile({ ...DEFAULT_PROFILE, name: 'already-there' });
      await prepared.destroy();

      await seedFiles();
      const result = await changeStorage({ backend: dialect, sql: settings() });
      expect(result).toMatchObject({ existing: true, copied: 0 });
      expect((await getRepository().listProfiles()).map((p) => p.name)).toEqual(['already-there']);
    });

    it('switches back to the files, which are untouched', async () => {
      await seedFiles();
      await changeStorage({ backend: dialect, sql: settings() });
      await changeStorage({ backend: 'file' });
      expect(getBackendName()).toBe('file');
      expect((await getRepository().listProfiles()).map((p) => p.name)).toEqual(['p']);
    });

    it('is configured by KASSANDRA_DB_URL, which fixes the settings', async () => {
      await seedFiles();
      process.env.KASSANDRA_DB_URL = url;
      process.env.KASSANDRA_DB_SCHEMA = ns.connection.schema;
      // The URL names the server's database; the test namespace for PostgreSQL is the schema, for MySQL its own database.
      if (dialect === 'mysql') process.env.KASSANDRA_DB_URL = url.replace(/\/[^/?]*(\?|$)/, `/${ns.connection.database}$1`);
      expect(getSetupInfo()).toMatchObject({ sqlLocked: true, sql: { dialect } });
      await changeStorage({ backend: dialect });
      expect(await getRepository().listProfiles()).toHaveLength(1);
    });

    it('stays on the previous storage when the database rejects the credentials', async () => {
      const error = await changeStorage({ backend: dialect, sql: settings({ username: 'kassandra_nobody', password: 'wrong-password' }) }).catch((e) => e);
      expect(error).toMatchObject({ status: 400 });
      expect(error.message).not.toContain('wrong-password');
      expect(getBackendName()).toBe('file');
    });
  });
}
