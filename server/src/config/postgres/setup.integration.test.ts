/**
 * Switching the storage to PostgreSQL from the Configuration page, against a
 * real database. See repository.integration.test.ts for how these are run.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { getBackendName, maskPostgresUrl } from '../backend.js';
import { DocumentRepository } from '../documentRepository.js';
import { FileStorage } from '../fileStorage.js';
import { getRepository } from '../registry.js';
import { changeStorage, getSetupInfo } from '../setup.js';
import { closeSharedPostgresRepository, PostgresRepository } from './repository.js';

const url = process.env.KASSANDRA_TEST_PG_URL;
if (!url) {
  throw new Error('KASSANDRA_TEST_PG_URL is not set; run `npm run test:integration -w @kassandra/server`');
}

const admin = new pg.Pool({ connectionString: url, max: 2 });
afterAll(() => admin.end());

describe('switching the storage to PostgreSQL', () => {
  let home: string;
  let schema: string;
  const savedHome = process.env.HOME;
  const t = { connection: 'p', keyspace: 'ks', table: 't' };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    schema = `kassandra_test_${crypto.randomBytes(6).toString('hex')}`;
    process.env.HOME = home;
    for (const name of ['KASSANDRA_HOME', 'KASSANDRA_STORAGE', 'KASSANDRA_PG_URL', 'KASSANDRA_PG_SCHEMA']) delete process.env[name];
  });
  afterEach(async () => {
    closeSharedPostgresRepository();
    process.env.HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
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
    const result = await changeStorage({ backend: 'postgres', postgresUrl: url, postgresSchema: schema });
    expect(result).toMatchObject({ backend: 'postgres', postgresSchema: schema, copied: 3, existing: false });
    // Only the password is hidden; the database and schema names may well contain the same word.
    const { password } = new URL(url);
    expect(result.postgresUrl).toBe(maskPostgresUrl(url));
    expect(result.postgresUrl).not.toContain(`:${password}@`);
    expect(JSON.stringify(result)).not.toContain(`:${password}@`);
    expect(getBackendName()).toBe('postgres');

    const active = getRepository();
    expect(active).toBeInstanceOf(PostgresRepository);
    expect((await active.listProfiles()).map((p) => p.name)).toEqual(['p']);
    expect((await active.listSavedQueries()).map((q) => q.name)).toEqual(['q']);
    expect(await active.getTableMetadata(t)).toEqual({ c: { hide: true } });
  });

  it('keeps the saved URL when the masked one is sent back, and treats it as unchanged', async () => {
    await changeStorage({ backend: 'postgres', postgresUrl: url, postgresSchema: schema });
    const again = await changeStorage({ backend: 'postgres', postgresUrl: getSetupInfo().postgresUrl, postgresSchema: schema });
    expect(again).toMatchObject({ backend: 'postgres', copied: 0, existing: false });
    expect(getBackendName()).toBe('postgres');
    // Still connects with the real password.
    expect(await getRepository().isEmpty()).toBe(true);
  });

  it('uses a database that already holds a configuration as is, without copying over it', async () => {
    const prepared = new PostgresRepository(url, { schema });
    await prepared.migrate();
    await prepared.upsertProfile({ ...DEFAULT_PROFILE, name: 'already-there' });
    await prepared.destroy();

    await seedFiles();
    const result = await changeStorage({ backend: 'postgres', postgresUrl: url, postgresSchema: schema });
    expect(result).toMatchObject({ existing: true, copied: 0 });
    expect((await getRepository().listProfiles()).map((p) => p.name)).toEqual(['already-there']);
  });

  it('switches back to the files, which are untouched', async () => {
    await seedFiles();
    await changeStorage({ backend: 'postgres', postgresUrl: url, postgresSchema: schema });
    await changeStorage({ backend: 'file' });
    expect(getBackendName()).toBe('file');
    expect((await getRepository().listProfiles()).map((p) => p.name)).toEqual(['p']);
  });

  it('stays on the previous storage when the new database rejects the credentials', async () => {
    const bad = new URL(url);
    bad.password = 'wrong-password';
    const error = await changeStorage({ backend: 'postgres', postgresUrl: bad.toString(), postgresSchema: schema }).catch((e) => e);
    expect(error).toMatchObject({ status: 400 });
    expect(error.message).not.toContain('wrong-password');
    expect(getBackendName()).toBe('file');
  });
});
