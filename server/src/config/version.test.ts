import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from './store.js';
import {
  BASELINE_VERSION,
  getAppVersion,
  readConfigVersion,
  writeConfigVersion,
} from './version.js';

describe('config VERSION file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    process.env.KASSANDRA_HOME = dir;
  });
  afterEach(() => {
    delete process.env.KASSANDRA_HOME;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is created with the app version on first run', () => {
    loadSettings();
    expect(fs.readFileSync(path.join(dir, 'VERSION'), 'utf-8')).toBe(`${getAppVersion()}\n`);
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('stamps an existing config without VERSION as the baseline', () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{}');
    expect(readConfigVersion(dir)).toBe(BASELINE_VERSION);
    loadSettings();
    expect(fs.readFileSync(path.join(dir, 'VERSION'), 'utf-8')).toBe(`${BASELINE_VERSION}\n`);
  });

  it('reads back a written version and returns null for an empty directory', () => {
    expect(readConfigVersion(dir)).toBeNull();
    writeConfigVersion(dir, '1.2.3');
    expect(readConfigVersion(dir)).toBe('1.2.3');
  });

  it('does not overwrite an existing VERSION on save', () => {
    writeConfigVersion(dir, '0.9.0');
    saveSettings(loadSettings());
    expect(readConfigVersion(dir)).toBe('0.9.0');
  });
});
