import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBackendName, getSqlitePath } from './backend.js';
import { FileStorage } from './fileStorage.js';
import { changeStorage, getSetupInfo, initSetupState } from './setup.js';
import { SqliteStorage, closeSharedSqliteStorage } from './sqliteStorage.js';
import { getStorage } from './storage.js';
import { getAppVersion } from './version.js';

describe('switching the storage backend', () => {
  let home: string;
  let work: string;
  const savedHome = process.env.HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-work-'));
    process.env.HOME = home;
    delete process.env.KASSANDRA_HOME;
    delete process.env.KASSANDRA_STORAGE;
    delete process.env.KASSANDRA_SQLITE_PATH;
  });
  afterEach(() => {
    closeSharedSqliteStorage();
    process.env.HOME = savedHome;
    delete process.env.KASSANDRA_STORAGE;
    delete process.env.KASSANDRA_SQLITE_PATH;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  const seedFiles = async () => {
    const files = new FileStorage(path.join(home, '.kassandra'));
    await files.put('config', { profiles: [{ name: 'p' }] });
    await files.put('tables/p-ks.t', { columns: {} });
    await files.setVersion(getAppVersion());
    return files;
  };

  it('defaults to the file backend with a database path in the config directory', () => {
    const info = getSetupInfo();
    expect(info).toMatchObject({
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
    expect(result).toMatchObject({ backend: 'sqlite', sqlitePath: db, copied: 2, existing: false });

    const active = getStorage();
    expect(active).toBeInstanceOf(SqliteStorage);
    expect(await active.get('config')).toEqual({ profiles: [{ name: 'p' }] });
    expect(await active.get('tables/p-ks.t')).toEqual({ columns: {} });
    expect(await active.getVersion()).not.toBeNull();
    // The JSON files are left in place.
    expect(await files.get('config')).toEqual({ profiles: [{ name: 'p' }] });
    expect(getBackendName()).toBe('sqlite');
    expect(getSqlitePath()).toBe(db);
    expect(getSetupInfo().firstRun).toBe(false);
  });

  it('starts empty when migrate is false', async () => {
    await seedFiles();
    const result = await changeStorage({ backend: 'sqlite', sqlitePath: path.join(work, 'k.db'), migrate: false });
    expect(result.copied).toBe(0);
    expect(await getStorage().get('config')).toBeUndefined();
  });

  it('uses a database that already holds a configuration as is', async () => {
    await seedFiles();
    const db = path.join(work, 'k.db');
    const existing = new SqliteStorage(db);
    await existing.put('config', { from: 'db' });
    existing.close();
    const result = await changeStorage({ backend: 'sqlite', sqlitePath: db });
    expect(result).toMatchObject({ copied: 0, existing: true });
    expect(await getStorage().get('config')).toEqual({ from: 'db' });
  });

  it('defaults the database to kassandra.db in the config directory', async () => {
    const result = await changeStorage({ backend: 'sqlite' });
    expect(result.sqlitePath).toBe(path.join(home, '.kassandra', 'kassandra.db'));
    expect(fs.existsSync(result.sqlitePath)).toBe(true);
  });

  it('can go back to the files', async () => {
    await seedFiles();
    await changeStorage({ backend: 'sqlite', sqlitePath: path.join(work, 'k.db') });
    await getStorage().put('config', { edited: true });
    const result = await changeStorage({ backend: 'file' });
    expect(result).toMatchObject({ backend: 'file', existing: true });
    expect(await getStorage().get('config')).toEqual({ profiles: [{ name: 'p' }] });
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
    expect(initSetupState()).toBeUndefined();
    expect(getSetupInfo().firstRun).toBe(false);
    await expect(changeStorage({ backend: 'sqlite' })).rejects.toThrow(/KASSANDRA_STORAGE/);
  });

  it('honours KASSANDRA_SQLITE_PATH over the saved one', async () => {
    process.env.KASSANDRA_SQLITE_PATH = path.join(work, 'env.db');
    const result = await changeStorage({ backend: 'sqlite', sqlitePath: path.join(work, 'ignored.db') });
    expect(result).toMatchObject({ sqlitePath: path.join(work, 'env.db'), sqlitePathLocked: true });
  });
});
