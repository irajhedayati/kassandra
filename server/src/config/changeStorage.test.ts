import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { getBackendName, getSqlitePath } from './backend.js';
import { DocumentRepository } from './documentRepository.js';
import { FileStorage } from './fileStorage.js';
import { getRepository } from './registry.js';
import { changeStorage, getSetupInfo, initSetupState } from './setup.js';
import { closeSharedSqliteRepository, SqliteRepository } from './sqlite/repository.js';

describe('switching the storage backend', () => {
  let home: string;
  let work: string;
  const savedHome = process.env.HOME;
  const t = { connection: 'p', keyspace: 'ks', table: 't' };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-work-'));
    process.env.HOME = home;
    delete process.env.KASSANDRA_HOME;
    delete process.env.KASSANDRA_STORAGE;
    delete process.env.KASSANDRA_SQLITE_PATH;
  });
  afterEach(() => {
    closeSharedSqliteRepository();
    process.env.HOME = savedHome;
    delete process.env.KASSANDRA_STORAGE;
    delete process.env.KASSANDRA_SQLITE_PATH;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  /** A migrated JSON configuration with one profile, one saved query and one table. */
  const seedFiles = async () => {
    const files = new DocumentRepository(new FileStorage(path.join(home, '.kassandra')));
    await files.migrate();
    await files.upsertProfile({ ...DEFAULT_PROFILE, name: 'p', hosts: ['h1', 'h2'] });
    await files.addFavoriteKeyspace('p', 'ks');
    await files.setColumnMetadata(t, 'c', { hide: true });
    await files.createSavedQuery({ name: 'q', description: '', query: 'SELECT 1', paramTypes: {} });
    return files;
  };

  it('defaults to the file backend with a database path in the config directory', () => {
    expect(getSetupInfo()).toMatchObject({
      backend: 'file',
      backendLocked: false,
      sqlitePath: path.join(home, '.kassandra', 'kassandra.db'),
      sqlitePathLocked: false,
    });
  });

  it('copies the JSON configuration into a new SQLite database and uses it', async () => {
    const files = await seedFiles();
    const db = path.join(work, 'k.db');
    const result = await changeStorage({ backend: 'sqlite', sqlitePath: db });
    expect(result).toMatchObject({ backend: 'sqlite', sqlitePath: db, copied: 3, existing: false });

    const active = getRepository();
    expect(active).toBeInstanceOf(SqliteRepository);
    expect(await active.listProfiles()).toEqual(await files.listProfiles());
    expect(await active.getFavoriteKeyspaces('p')).toEqual(['ks']);
    expect(await active.getTableMetadata(t)).toEqual({ c: { hide: true } });
    expect((await active.listSavedQueries()).map((q) => q.name)).toEqual(['q']);
    expect(await active.getVersion()).not.toBeNull();
    // The JSON files are left in place.
    expect((await files.listProfiles()).map((p) => p.name)).toEqual(['p']);
    expect(getBackendName()).toBe('sqlite');
    expect(getSqlitePath()).toBe(db);
    expect(getSetupInfo().firstRun).toBe(false);
  });

  it('starts empty when migrate is false', async () => {
    await seedFiles();
    const result = await changeStorage({ backend: 'sqlite', sqlitePath: path.join(work, 'k.db'), migrate: false });
    expect(result.copied).toBe(0);
    expect(await getRepository().isEmpty()).toBe(true);
  });

  it('uses a database that already holds a configuration as is', async () => {
    await seedFiles();
    const db = path.join(work, 'k.db');
    const existing = new SqliteRepository(db);
    await existing.migrate();
    await existing.upsertProfile({ ...DEFAULT_PROFILE, name: 'from-db' });
    existing.close();
    const result = await changeStorage({ backend: 'sqlite', sqlitePath: db });
    expect(result).toMatchObject({ copied: 0, existing: true });
    expect((await getRepository().listProfiles()).map((p) => p.name)).toEqual(['from-db']);
  });

  it('defaults the database to kassandra.db in the config directory', async () => {
    const result = await changeStorage({ backend: 'sqlite' });
    expect(result.sqlitePath).toBe(path.join(home, '.kassandra', 'kassandra.db'));
    expect(fs.existsSync(result.sqlitePath)).toBe(true);
  });

  it('can go back to the files', async () => {
    await seedFiles();
    await changeStorage({ backend: 'sqlite', sqlitePath: path.join(work, 'k.db') });
    await getRepository().createSavedQuery({ name: 'only-in-db', description: '', query: 'SELECT 2', paramTypes: {} });
    const result = await changeStorage({ backend: 'file' });
    expect(result).toMatchObject({ backend: 'file', existing: true });
    expect(getRepository()).toBeInstanceOf(DocumentRepository);
    expect((await getRepository().listSavedQueries()).map((q) => q.name)).toEqual(['q']);
  });

  it('copies from SQLite into an empty file location', async () => {
    await seedFiles();
    await changeStorage({ backend: 'sqlite', sqlitePath: path.join(work, 'k.db') });
    fs.rmSync(path.join(home, '.kassandra', 'config.json'));
    fs.rmSync(path.join(home, '.kassandra', 'tables'), { recursive: true });
    fs.rmSync(path.join(home, '.kassandra', 'VERSION'));
    await changeStorage({ backend: 'file' });
    expect((await getRepository().listProfiles()).map((p) => p.name)).toEqual(['p']);
    expect(await getRepository().getTableMetadata(t)).toEqual({ c: { hide: true } });
  });

  it('rejects an unusable database path with a clear message', async () => {
    const asDir = path.join(work, 'dir');
    fs.mkdirSync(asDir);
    await expect(changeStorage({ backend: 'sqlite', sqlitePath: asDir })).rejects.toThrow(/Cannot use .*is a directory/);
    const notDb = path.join(work, 'notdb.db');
    fs.writeFileSync(notDb, 'this is not a database file at all, just text');
    await expect(changeStorage({ backend: 'sqlite', sqlitePath: notDb })).rejects.toThrow(/Cannot use/);
    await expect(changeStorage({ backend: 'sqlite', sqlitePath: 'relative.db' })).rejects.toThrow(/absolute/);
    expect(getBackendName()).toBe('file');
  });

  it('is refused when KASSANDRA_STORAGE fixes the backend', async () => {
    process.env.KASSANDRA_STORAGE = 'file';
    expect(getSetupInfo().backendLocked).toBe(true);
    initSetupState();
    expect(getSetupInfo().firstRun).toBe(false);
    await expect(changeStorage({ backend: 'sqlite' })).rejects.toThrow(/KASSANDRA_STORAGE/);
  });

  it('honours KASSANDRA_SQLITE_PATH over the saved one', async () => {
    process.env.KASSANDRA_SQLITE_PATH = path.join(work, 'env.db');
    const result = await changeStorage({ backend: 'sqlite', sqlitePath: path.join(work, 'ignored.db') });
    expect(result).toMatchObject({ sqlitePath: path.join(work, 'env.db'), sqlitePathLocked: true });
  });
});
