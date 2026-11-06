import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from './fileStorage.js';
import {
  defaultConfigDir,
  ensureWritableDir,
  expandLocation,
  getConfigDir,
  saveLocation,
} from './location.js';
import { changeLocation, getSetupInfo, initSetupState } from './setup.js';
import { getRepository } from './registry.js';
import { compareVersions, getAppVersion } from './version.js';

// Documents without the backups a migration may have just made.
const docs = async (s: FileStorage) => (await s.list('')).filter((k) => !k.startsWith('backups/'));

describe('configuration location and first run', () => {
  let home: string;
  let work: string;
  const savedHome = process.env.HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-work-'));
    process.env.HOME = home;
    delete process.env.KASSANDRA_HOME;
  });
  afterEach(() => {
    process.env.HOME = savedHome;
    delete process.env.KASSANDRA_HOME;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  describe('resolving the location', () => {
    it('defaults to ~/.kassandra', () => {
      expect(getConfigDir()).toBe(path.join(home, '.kassandra'));
      expect(defaultConfigDir()).toBe(path.join(home, '.kassandra'));
    });

    it('prefers the saved location over the default, and KASSANDRA_HOME over both', () => {
      saveLocation(path.join(work, 'saved'));
      expect(getConfigDir()).toBe(path.join(work, 'saved'));
      process.env.KASSANDRA_HOME = path.join(work, 'env');
      expect(getConfigDir()).toBe(path.join(work, 'env'));
    });

    it('keeps the pointer out of the documents the storage lists', async () => {
      saveLocation(path.join(work, 'x'));
      expect(await new FileStorage(defaultConfigDir()).list('')).toEqual([]);
    });

    it('expands ~ and rejects empty and relative input', () => {
      expect(expandLocation('~/cfg')).toBe(path.join(home, 'cfg'));
      expect(expandLocation('  /a/b/../c ')).toBe('/a/c');
      for (const bad of ['', '   ', 'relative/dir', './x']) {
        expect(() => expandLocation(bad)).toThrow(/required|absolute/);
      }
    });

    it('creates a missing directory and rejects a file', async () => {
      const dir = path.join(work, 'a', 'b');
      await ensureWritableDir(dir);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
      expect(fs.readdirSync(dir)).toEqual([]);
      const file = path.join(work, 'file');
      fs.writeFileSync(file, 'x');
      await expect(ensureWritableDir(file)).rejects.toThrow(/Cannot use/);
    });
  });

  describe('first run', () => {
    it('is true for a brand-new machine', () => {
      initSetupState();
      expect(getSetupInfo()).toMatchObject({
        firstRun: true,
        locked: false,
        location: path.join(home, '.kassandra'),
        defaultLocation: path.join(home, '.kassandra'),
      });
    });

    it('is false for an existing install, a chosen location, or a fixed one', () => {
      fs.mkdirSync(path.join(home, '.kassandra'));
      fs.writeFileSync(path.join(home, '.kassandra', 'config.json'), '{}');
      initSetupState();
      expect(getSetupInfo().firstRun).toBe(false);

      fs.rmSync(path.join(home, '.kassandra'), { recursive: true });
      saveLocation(path.join(work, 'x'));
      initSetupState();
      expect(getSetupInfo().firstRun).toBe(false);

      fs.rmSync(path.join(home, '.kassandra'), { recursive: true });
      process.env.KASSANDRA_HOME = path.join(work, 'env');
      initSetupState();
      expect(getSetupInfo()).toMatchObject({ firstRun: false, locked: true });
    });

    it('is not affected by the default directory only holding a VERSION file', () => {
      fs.mkdirSync(path.join(home, '.kassandra'));
      fs.writeFileSync(path.join(home, '.kassandra', 'VERSION'), '1.6.0\n');
      initSetupState();
      expect(getSetupInfo().firstRun).toBe(true);
    });
  });

  describe('changing the location', () => {
    const seed = async () => {
      const from = new FileStorage(path.join(home, '.kassandra'));
      await from.put('config', { connections: [{ name: 'c1', hosts: ['h'] }], saved_queries: [] });
      await from.put('tables/c1-ks.t', { a: { hide: true } });
      await from.put('backups/1.5.0/config', { old: true });
      await from.setVersion(getAppVersion());
    };

    it('saving the default on a first run just marks setup done', async () => {
      initSetupState();
      const result = await changeLocation('~/.kassandra');
      expect(result).toMatchObject({ firstRun: false, copied: 0, existing: false });
      expect(getSetupInfo().firstRun).toBe(false);
      expect(fs.existsSync(path.join(home, '.kassandra', '.location'))).toBe(true);
    });

    it('copies the configuration to an empty location and switches to it', async () => {
      await seed();
      initSetupState();
      const target = path.join(work, 'new');
      const result = await changeLocation(target);

      expect(result).toMatchObject({ location: target, copied: 2, existing: false });
      expect(getConfigDir()).toBe(target);
      expect(getRepository().description).toBe(target);
      const to = new FileStorage(target);
      expect(await docs(to)).toEqual(['config', 'tables/c1-ks.t']);
      expect(await to.get('tables/c1-ks.t')).toEqual({ a: { hide: true } });
      expect(compareVersions((await to.getVersion())!, getAppVersion())).toBeGreaterThanOrEqual(0);
      // the old location is left alone
      expect(await new FileStorage(path.join(home, '.kassandra')).list('config')).toEqual(['config']);
    });

    it('uses an existing configuration at the new location without overwriting it', async () => {
      await seed();
      const target = path.join(work, 'other');
      const other = new FileStorage(target);
      await other.put('config', { connections: [], saved_queries: [], mine: true });
      await other.setVersion(getAppVersion());

      const result = await changeLocation(target);
      expect(result).toMatchObject({ existing: true, copied: 0 });
      expect(await other.get('config')).toMatchObject({ mine: true });
      expect(await docs(other)).toEqual(['config']);
    });

    it('migrates an older configuration at the new location', async () => {
      const target = path.join(work, 'old');
      const other = new FileStorage(target);
      await other.put('config', {
        connections: [{ name: 'c1', hosts: ['h'] }],
        table_metadata: { 'ks.t': { a: { hide: true } } },
      });
      await other.setVersion('1.5.0');
      await changeLocation(target);
      expect(await other.list('tables/')).toEqual(['tables/c1-ks.t']);
      expect(await other.get('config')).not.toHaveProperty('table_metadata');
    });

    it('does nothing to the files when the location is unchanged', async () => {
      await seed();
      const result = await changeLocation(path.join(home, '.kassandra'));
      expect(result).toMatchObject({ copied: 0, existing: false });
      expect(await new FileStorage(path.join(home, '.kassandra')).list('')).toContain('config');
    });

    it('is refused when KASSANDRA_HOME fixes the location', async () => {
      process.env.KASSANDRA_HOME = path.join(work, 'env');
      await expect(changeLocation(path.join(work, 'x'))).rejects.toMatchObject({ status: 409 });
      expect(fs.existsSync(path.join(work, 'x'))).toBe(false);
    });

    it('rejects an unusable location before changing anything', async () => {
      await seed();
      const file = path.join(work, 'file');
      fs.writeFileSync(file, 'x');
      await expect(changeLocation(file)).rejects.toMatchObject({ status: 400 });
      await expect(changeLocation('relative')).rejects.toMatchObject({ status: 400 });
      expect(getConfigDir()).toBe(path.join(home, '.kassandra'));
    });
  });
});
