import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { DocumentRepository } from './documentRepository.js';
import { FileStorage } from './fileStorage.js';
import { describeRepositoryContract } from './repository.contract.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));

describeRepositoryContract('DocumentRepository (files)', () => {
  const dir = tmp();
  return { repository: new DocumentRepository(new FileStorage(dir)), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
});

describe('DocumentRepository layout', () => {
  it('keeps settings in config.json and each table in its own file', async () => {
    const dir = tmp();
    try {
      const repo = new DocumentRepository(new FileStorage(dir));
      await repo.migrate();
      await repo.upsertProfile({ ...DEFAULT_PROFILE, name: 'c1' });
      await repo.setColumnMetadata({ connection: 'c1', keyspace: 'ks', table: 't' }, 'a', { hide: true });
      expect(fs.readdirSync(dir).sort()).toEqual(['VERSION', 'config.json', 'tables']);
      expect(fs.readdirSync(path.join(dir, 'tables'))).toEqual(['c1-ks.t.json']);
      const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
      expect(config.connections.map((c: { name: string }) => c.name)).toEqual(['c1']);
      expect(config).not.toHaveProperty('table_metadata');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
