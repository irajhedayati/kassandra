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

  it('keeps each profile\'s history in its own file and leaves config.json alone when recording', async () => {
    const dir = tmp();
    try {
      const repo = new DocumentRepository(new FileStorage(dir));
      await repo.migrate();
      await repo.upsertProfile({ ...DEFAULT_PROFILE, name: 'my cluster' });
      const configFile = path.join(dir, 'config.json');
      const before = fs.statSync(configFile).mtimeMs;
      const entry = await repo.addHistoryEntry({
        profile: 'my cluster',
        query: 'SELECT 1',
        params: [],
        started_at: '2026-01-01T00:00:00.000Z',
        duration_ms: 1,
        statements: 1,
        outcome: 'success',
        error: null,
      });
      expect(fs.readdirSync(path.join(dir, 'history'))).toEqual(['my%20cluster.json']);
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'history', 'my%20cluster.json'), 'utf-8'))).toEqual({
        entries: [entry],
      });
      expect(fs.statSync(configFile).mtimeMs).toBe(before);
      expect(JSON.parse(fs.readFileSync(configFile, 'utf-8'))).not.toHaveProperty('history');

      await repo.clearHistory('my cluster');
      expect(fs.readdirSync(path.join(dir, 'history'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
