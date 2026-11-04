import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { FileStorage } from '../fileStorage.js';
import { readTableMetadata, writeTableMetadata } from '../tables.js';
import { MIGRATIONS, runMigrations, type Migration } from './index.js';

const profile = (name: string) => ({ ...DEFAULT_PROFILE, name });

describe('config migrations', () => {
  let dir: string;
  let storage: FileStorage;
  const readConfig = () => storage.get('config') as Promise<Record<string, unknown>>;
  const writeConfig = (c: object) => storage.put('config', c);
  const meta = (c: string, ks: string, t: string) => readTableMetadata(storage, c, ks, t);
  const run = (migrations: Migration[], appVersion: string, lock = {}) =>
    runMigrations(storage, migrations, appVersion, lock);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    storage = new FileStorage(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('1.5.0 -> 1.6.0', () => {
    const legacyConfig = (connections: string[]) => ({
      connections: connections.map(profile),
      last_connection_name: '',
      table_metadata: { 'ks.t': { a: { hide: true } }, 'ks.u': { b: { display_type: 'JSON' } } },
      favorite_keyspaces: { c1: ['ks'] },
      saved_queries: [],
    });

    it('splits table_metadata into per-connection documents, keeps the rest, bumps the version', async () => {
      await writeConfig(legacyConfig(['c1', 'c2']));
      await storage.setVersion('1.5.0');

      expect(await run(MIGRATIONS, '1.6.0')).toEqual(['1.6.0']);

      for (const c of ['c1', 'c2']) {
        expect(await meta(c, 'ks', 't')).toEqual({ a: { hide: true } });
        expect(await meta(c, 'ks', 'u')).toEqual({ b: { display_type: 'JSON' } });
      }
      const after = await readConfig();
      expect(after).not.toHaveProperty('table_metadata');
      expect(after.favorite_keyspaces).toEqual({ c1: ['ks'] });
      expect(after.connections).toHaveLength(2);
      expect(await storage.getVersion()).toBe('1.6.0');
    });

    it('backs up config and tables/ before changing them', async () => {
      await writeConfig(legacyConfig(['c1']));
      await storage.setVersion('1.5.0');
      await writeTableMetadata(storage, 'c1', 'ks', 'old', { a: { hide: true } });
      await run(MIGRATIONS, '1.6.0');
      const backup = path.join(dir, 'backups', '1.5.0');
      const saved = JSON.parse(fs.readFileSync(path.join(backup, 'config.json'), 'utf-8'));
      expect(saved.table_metadata).toHaveProperty(['ks.t']);
      expect(fs.readdirSync(path.join(backup, 'tables'))).toEqual(['c1-ks.old.json']);
      expect(fs.existsSync(path.join(backup, 'backups'))).toBe(false);
    });

    it('keeps per-table documents that already exist', async () => {
      await writeConfig(legacyConfig(['c1']));
      await storage.setVersion('1.5.0');
      await writeTableMetadata(storage, 'c1', 'ks', 't', { a: { hide: false } });
      await run(MIGRATIONS, '1.6.0');
      expect(await meta('c1', 'ks', 't')).toEqual({ a: { hide: false } });
    });

    it('warns and drops the field when there are no connections (backup keeps it)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await writeConfig(legacyConfig([]));
      await storage.setVersion('1.5.0');
      await run(MIGRATIONS, '1.6.0');
      expect(warn).toHaveBeenCalled();
      expect(await readConfig()).not.toHaveProperty('table_metadata');
      expect(fs.existsSync(path.join(dir, 'backups', '1.5.0', 'config.json'))).toBe(true);
    });

    it('treats a config without a version as 1.5.0', async () => {
      await writeConfig(legacyConfig(['c1']));
      expect(await run(MIGRATIONS, '1.6.0')).toEqual(['1.6.0']);
      expect(await meta('c1', 'ks', 't')).toEqual({ a: { hide: true } });
    });

    it('is a no-op on an already-migrated config', async () => {
      await writeConfig({ ...legacyConfig(['c1']), table_metadata: undefined });
      await storage.setVersion('1.6.0');
      expect(await run(MIGRATIONS, '1.6.0')).toEqual([]);
      expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
    });

    it('fails clearly when config cannot be parsed, leaving the version alone', async () => {
      fs.writeFileSync(path.join(dir, 'config.json'), '{nope');
      await storage.setVersion('1.5.0');
      await expect(run(MIGRATIONS, '1.6.0')).rejects.toThrow(/Could not back up/);
      expect(await storage.getVersion()).toBe('1.5.0');
      expect(fs.existsSync(path.join(dir, '.migrate.lock'))).toBe(false);
    });
  });

  describe('runner', () => {
    const step = (version: string, calls: string[], fail = false): Migration => ({
      version,
      description: version,
      up: async () => {
        if (fail) throw new Error('boom');
        calls.push(version);
      },
    });
    const lockFile = () => path.join(dir, '.migrate.lock');

    it('stamps a fresh storage with the app version and runs nothing', async () => {
      const calls: string[] = [];
      expect(await run([step('1.6.0', calls)], '1.6.0')).toEqual([]);
      expect(calls).toEqual([]);
      expect(await storage.getVersion()).toBe('1.6.0');
    });

    it('applies pending migrations one by one in version order', async () => {
      const calls: string[] = [];
      await writeConfig({});
      await storage.setVersion('1.5.0');
      const all = [step('1.7.0', calls), step('1.6.0', calls), step('1.10.0', calls)];
      expect(await run(all, '1.10.0')).toEqual(['1.6.0', '1.7.0', '1.10.0']);
      expect(calls).toEqual(['1.6.0', '1.7.0', '1.10.0']);
      expect(await storage.getVersion()).toBe('1.10.0');
    });

    it('on failure keeps the version at the last completed step and reports the error', async () => {
      const calls: string[] = [];
      await writeConfig({});
      await storage.setVersion('1.5.0');
      const all = [step('1.6.0', calls), step('1.7.0', calls, true)];
      await expect(run(all, '1.7.0')).rejects.toThrow(/migration to 1\.7\.0 failed.*boom/);
      expect(await storage.getVersion()).toBe('1.6.0');
      expect(calls).toEqual(['1.6.0']);
    });

    it('advances the version to the app version when no migration is pending', async () => {
      await writeConfig({});
      await storage.setVersion('1.6.0');
      await run([], '1.6.3');
      expect(await storage.getVersion()).toBe('1.6.3');
    });

    it('leaves a config from a newer version untouched', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await writeConfig({});
      await storage.setVersion('2.0.0');
      expect(await run(MIGRATIONS, '1.6.0')).toEqual([]);
      expect(await storage.getVersion()).toBe('2.0.0');
    });

    it('removes its lock when done and when a migration fails', async () => {
      await writeConfig({});
      await storage.setVersion('1.5.0');
      await run([step('1.6.0', [])], '1.6.0');
      expect(fs.existsSync(lockFile())).toBe(false);
      await expect(run([step('1.7.0', [], true)], '1.7.0')).rejects.toThrow();
      expect(fs.existsSync(lockFile())).toBe(false);
    });

    it('does not take a lock when nothing is pending', async () => {
      await writeConfig({});
      await storage.setVersion('1.6.0');
      fs.writeFileSync(lockFile(), 'someone else');
      expect(await run([step('1.6.0', [])], '1.6.0')).toEqual([]);
      expect(fs.readFileSync(lockFile(), 'utf-8')).toBe('someone else');
    });

    it('times out while another process holds a fresh lock', async () => {
      await writeConfig({});
      await storage.setVersion('1.5.0');
      fs.writeFileSync(lockFile(), 'someone else');
      const calls: string[] = [];
      await expect(run([step('1.6.0', calls)], '1.6.0', { timeoutMs: 300 })).rejects.toThrow(/Timed out/);
      expect(calls).toEqual([]);
      expect(fs.readFileSync(lockFile(), 'utf-8')).toBe('someone else');
    });

    it('takes over a stale lock', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await writeConfig({});
      await storage.setVersion('1.5.0');
      fs.writeFileSync(lockFile(), 'crashed');
      const old = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(lockFile(), old, old);
      expect(await run([step('1.6.0', [])], '1.6.0')).toEqual(['1.6.0']);
    });

    it('does not repeat work another process finished while it waited for the lock', async () => {
      await writeConfig({});
      await storage.setVersion('1.5.0');
      const calls: string[] = [];
      const holder = await storage.lock();
      const waiting = run([step('1.6.0', calls)], '1.6.0', { timeoutMs: 5000 });
      // The other process finishes its migration, then releases the lock.
      await new Promise((r) => setTimeout(r, 100));
      await storage.setVersion('1.6.0');
      await holder();
      expect(await waiting).toEqual([]);
      expect(calls).toEqual([]);
    });
  });
});
