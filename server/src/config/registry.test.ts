import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentRepository } from './documentRepository.js';
import { FileStorage } from './fileStorage.js';
import { getRepository, registerStorageBackend } from './registry.js';

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
    expect(getRepository()).toBeInstanceOf(DocumentRepository);
  });

  it('uses the backend named by KASSANDRA_STORAGE', () => {
    const fake = new DocumentRepository(new FileStorage(path.join(home, 'fake')));
    registerStorageBackend('fake', () => fake);
    process.env.KASSANDRA_STORAGE = 'fake';
    expect(getRepository()).toBe(fake);
  });

  it('rejects an unknown backend, listing the available ones', () => {
    process.env.KASSANDRA_STORAGE = 'nope';
    expect(() => getRepository()).toThrow(/Unknown storage backend "nope".*file.*sqlite/);
  });
});
