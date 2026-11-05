import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from './fileStorage.js';
import { getStorage, registerStorageBackend } from './storage.js';

describe('storage backend selection', () => {
  let home: string;
  const savedHome = process.env.HOME;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    process.env.HOME = home;
    delete process.env.KASSANDRA_HOME;
  });
  afterEach(() => {
    process.env.HOME = savedHome;
    delete process.env.KASSANDRA_STORAGE;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('defaults to the file backend', () => {
    expect(getStorage()).toBeInstanceOf(FileStorage);
  });

  it('uses the backend named by KASSANDRA_STORAGE', () => {
    const fake = new FileStorage('/tmp/kassandra-fake');
    registerStorageBackend('fake', () => fake);
    process.env.KASSANDRA_STORAGE = 'fake';
    expect(getStorage()).toBe(fake);
  });

  it('rejects an unknown backend, listing the available ones', () => {
    process.env.KASSANDRA_STORAGE = 'nope';
    expect(() => getStorage()).toThrow(/Unknown storage backend "nope".*file/);
  });
});
