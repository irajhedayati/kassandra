import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { getTableMetadata } from '../store.js';
import { readTableMetadata, writeTableMetadata } from '../tables.js';
import { readConfigVersion, writeConfigVersion } from '../version.js';
import { MIGRATIONS, runMigrations, type Migration } from './index.js';

const profile = (name: string) => ({ ...DEFAULT_PROFILE, name });

describe('config migrations', () => {
  let dir: string;
  const configFile = () => path.join(dir, 'config.json');
  const readConfig = () => JSON.parse(fs.readFileSync(configFile(), 'utf-8'));
  const writeConfig = (c: object) => fs.writeFileSync(configFile(), JSON.stringify(c));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    process.env.KASSANDRA_HOME = dir;
  });
  afterEach(() => {
    delete process.env.KASSANDRA_HOME;
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

    it('splits table_metadata into per-connection files, keeps the rest, bumps VERSION', () => {
      writeConfig(legacyConfig(['c1', 'c2']));
      writeConfigVersion(dir, '1.5.0');

      expect(runMigrations(dir, MIGRATIONS, '1.6.0')).toEqual(['1.6.0']);

      for (const c of ['c1', 'c2']) {
        expect(getTableMetadata(c, 'ks', 't')).toEqual({ a: { hide: true } });
        expect(getTableMetadata(c, 'ks', 'u')).toEqual({ b: { display_type: 'JSON' } });
      }
      const after = readConfig();
      expect(after).not.toHaveProperty('table_metadata');
      expect(after.favorite_keyspaces).toEqual({ c1: ['ks'] });
      expect(after.connections).toHaveLength(2);
      expect(readConfigVersion(dir)).toBe('1.6.0');
    });

    it('backs up config.json before changing it', () => {
      writeConfig(legacyConfig(['c1']));
      writeConfigVersion(dir, '1.5.0');
      runMigrations(dir, MIGRATIONS, '1.6.0');
      const backup = JSON.parse(fs.readFileSync(`${configFile()}.bak-1.5.0`, 'utf-8'));
      expect(backup.table_metadata).toHaveProperty(['ks.t']);
    });

    it('keeps per-table files that already exist', () => {
      writeConfig(legacyConfig(['c1']));
      writeConfigVersion(dir, '1.5.0');
      writeTableMetadata(dir, 'c1', 'ks', 't', { a: { hide: false } });
      runMigrations(dir, MIGRATIONS, '1.6.0');
      expect(readTableMetadata(dir, 'c1', 'ks', 't')).toEqual({ a: { hide: false } });
    });

    it('warns and drops the field when there are no connections (backup keeps it)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      writeConfig(legacyConfig([]));
      writeConfigVersion(dir, '1.5.0');
      runMigrations(dir, MIGRATIONS, '1.6.0');
      expect(warn).toHaveBeenCalled();
      expect(readConfig()).not.toHaveProperty('table_metadata');
      expect(fs.existsSync(`${configFile()}.bak-1.5.0`)).toBe(true);
    });

    it('treats a config without VERSION as 1.5.0', () => {
      writeConfig(legacyConfig(['c1']));
      expect(runMigrations(dir, MIGRATIONS, '1.6.0')).toEqual(['1.6.0']);
      expect(getTableMetadata('c1', 'ks', 't')).toEqual({ a: { hide: true } });
    });

    it('is a no-op on an already-migrated config', () => {
      writeConfig({ ...legacyConfig(['c1']), table_metadata: undefined });
      writeConfigVersion(dir, '1.6.0');
      expect(runMigrations(dir, MIGRATIONS, '1.6.0')).toEqual([]);
      expect(fs.existsSync(`${configFile()}.bak-1.6.0`)).toBe(false);
    });
  });

  describe('runner', () => {
    const step = (version: string, calls: string[], fail = false): Migration => ({
      version,
      description: version,
      up: () => {
        if (fail) throw new Error('boom');
        calls.push(version);
      },
    });

    it('stamps a fresh directory with the app version and runs nothing', () => {
      const calls: string[] = [];
      expect(runMigrations(dir, [step('1.6.0', calls)], '1.6.0')).toEqual([]);
      expect(calls).toEqual([]);
      expect(readConfigVersion(dir)).toBe('1.6.0');
    });

    it('applies pending migrations one by one in version order', () => {
      const calls: string[] = [];
      writeConfig({});
      writeConfigVersion(dir, '1.5.0');
      const all = [step('1.7.0', calls), step('1.6.0', calls), step('1.10.0', calls)];
      expect(runMigrations(dir, all, '1.10.0')).toEqual(['1.6.0', '1.7.0', '1.10.0']);
      expect(calls).toEqual(['1.6.0', '1.7.0', '1.10.0']);
      expect(readConfigVersion(dir)).toBe('1.10.0');
    });

    it('on failure keeps VERSION at the last completed step and reports the error', () => {
      const calls: string[] = [];
      writeConfig({});
      writeConfigVersion(dir, '1.5.0');
      const all = [step('1.6.0', calls), step('1.7.0', calls, true)];
      expect(() => runMigrations(dir, all, '1.7.0')).toThrow(/migration to 1\.7\.0 failed.*boom/);
      expect(readConfigVersion(dir)).toBe('1.6.0');
      expect(calls).toEqual(['1.6.0']);
    });

    it('advances VERSION to the app version when no migration is pending', () => {
      writeConfig({});
      writeConfigVersion(dir, '1.6.0');
      runMigrations(dir, [], '1.6.3');
      expect(readConfigVersion(dir)).toBe('1.6.3');
    });

    it('leaves a config from a newer version untouched', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      writeConfig({});
      writeConfigVersion(dir, '2.0.0');
      expect(runMigrations(dir, MIGRATIONS, '1.6.0')).toEqual([]);
      expect(readConfigVersion(dir)).toBe('2.0.0');
    });
  });
});
