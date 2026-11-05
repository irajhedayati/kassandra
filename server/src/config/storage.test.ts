import { afterEach, describe, expect, it } from 'vitest';
import { FileStorage } from './fileStorage.js';
import { getStorage, registerStorageBackend } from './storage.js';

describe('storage backend selection', () => {
  afterEach(() => {
    delete process.env.KASSANDRA_STORAGE;
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
