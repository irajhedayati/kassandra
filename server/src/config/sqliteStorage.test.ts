import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { describeStorageContract } from './storage.contract.js';
import { SqliteStorage } from './sqliteStorage.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-sqlite-'));

describeStorageContract('SqliteStorage', () => {
  const dir = tmp();
  const storage = new SqliteStorage(path.join(dir, 'nested', 'kassandra.db'));
  return {
    storage,
    cleanup: () => {
      storage.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
});

describe('SqliteStorage', () => {
  it('persists across instances and shares the lock between them', async () => {
    const dir = tmp();
    const file = path.join(dir, 'k.db');
    const a = new SqliteStorage(file);
    const b = new SqliteStorage(file);
    try {
      await a.put('config', { n: 1 });
      await a.setVersion('1.6.0');
      expect(await b.get('config')).toEqual({ n: 1 });
      expect(await b.getVersion()).toBe('1.6.0');
      const release = await a.lock();
      await expect(b.lock({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
      await release();
      await (await b.lock({ timeoutMs: 300 }))();
    } finally {
      a.close();
      b.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the schema once and records its version', () => {
    const dir = tmp();
    const file = path.join(dir, 'k.db');
    try {
      new SqliteStorage(file).close();
      new SqliteStorage(file).close();
      const db = new DatabaseSync(file);
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a database from a newer Kassandra', () => {
    const dir = tmp();
    const file = path.join(dir, 'k.db');
    try {
      const db = new DatabaseSync(file);
      db.exec('PRAGMA user_version = 99');
      db.close();
      expect(() => new SqliteStorage(file)).toThrow(/newer than this version/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid keys like the file backend', async () => {
    const dir = tmp();
    const s = new SqliteStorage(path.join(dir, 'k.db'));
    try {
      await expect(s.put('../x', {})).rejects.toThrow(/Invalid storage key/);
      await expect(s.get('a//b')).rejects.toThrow(/Invalid storage key/);
    } finally {
      s.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
