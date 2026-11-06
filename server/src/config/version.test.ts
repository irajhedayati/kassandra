import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from './fileStorage.js';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { listProfiles, upsertProfile } from './store.js';
import { compareVersions, getAppVersion, initConfigVersion, LEGACY_VERSION } from './version.js';

describe('config version', () => {
  let dir: string;
  let storage: FileStorage;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    process.env.KASSANDRA_HOME = dir;
    storage = new FileStorage(dir);
  });
  afterEach(() => {
    delete process.env.KASSANDRA_HOME;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is created with the app version on first run', async () => {
    await listProfiles();
    expect(fs.readFileSync(path.join(dir, 'VERSION'), 'utf-8')).toBe(`${getAppVersion()}\n`);
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('stamps an existing config without VERSION with the last pre-versioning release', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{}');
    await listProfiles();
    expect(await storage.getVersion()).toBe(LEGACY_VERSION);
  });

  it('stamps even when the existing config cannot be parsed', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{nope');
    await initConfigVersion(storage, '9.9.9');
    expect(await storage.getVersion()).toBe(LEGACY_VERSION);
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0', '1.6.0')).toBeLessThan(0);
    expect(compareVersions('1.6', '1.6.0')).toBe(0);
    expect(compareVersions('1.6.0-rc.1', '1.6.0')).toBe(0);
  });

  it('does not overwrite an existing version on save', async () => {
    await storage.setVersion('0.9.0');
    await upsertProfile({ ...DEFAULT_PROFILE, name: 'p' });
    expect(await storage.getVersion()).toBe('0.9.0');
  });
});
