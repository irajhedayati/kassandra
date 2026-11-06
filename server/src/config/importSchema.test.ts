import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { DocumentRepository } from './documentRepository.js';
import { FileStorage } from './fileStorage.js';
import { importTableMetadata } from './importSchema.js';
import type { ConfigRepository } from './repository.js';
import { SqliteRepository } from './sqlite/repository.js';
import { listTableFiles, parseTableFileName, tableFileName } from './tables.js';

describe('table file names', () => {
  it('lists files with their parsed names and column counts, skipping foreign files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    try {
      const storage = new FileStorage(dir);
      const repo = new DocumentRepository(storage);
      await repo.replaceTableMetadata({ connection: 'dev', keyspace: 'ks', table: 't' }, { a: {}, b: {} });
      await repo.replaceTableMetadata({ connection: 'my cluster', keyspace: 'ks2', table: 'u' }, {});
      fs.writeFileSync(path.join(dir, 'tables', 'notes.txt'), 'x');
      fs.writeFileSync(path.join(dir, 'tables', 'bad-name.json'), '{}');
      expect(await listTableFiles(storage)).toEqual([
        { file: 'dev-ks.t.json', connection: 'dev', keyspace: 'ks', table: 't', columns: 2 },
        { file: 'my%20cluster-ks2.u.json', connection: 'my cluster', keyspace: 'ks2', table: 'u', columns: 0 },
      ]);
      expect(await listTableFiles(new FileStorage(path.join(dir, 'nope')))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses names back to their parts', () => {
    expect(parseTableFileName(tableFileName('a-b c', 'k', 't'))).toEqual({
      connection: 'a-b c',
      keyspace: 'k',
      table: 't',
    });
    expect(parseTableFileName('config.json')).toBeNull();
    expect(parseTableFileName('a-b.c.json%')).toBeNull();
  });
});

const backends: [string, (dir: string) => ConfigRepository][] = [
  ['documents', (dir) => new DocumentRepository(new FileStorage(dir))],
  ['sqlite', (dir) => new SqliteRepository(path.join(dir, 'k.db'))],
];

describe.each(backends)('import table metadata (%s)', (_name, create) => {
  let dir: string;
  let repo: ConfigRepository;
  const target = { connection: 'prod', keyspace: 'ks', table: 't', columns: ['id', 'name', 'tags'] };
  const prod = { connection: 'prod', keyspace: 'ks', table: 't' };
  const sourceName = 'dev-ks.t.json';

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    repo = create(dir);
    await repo.migrate();
    await repo.upsertProfile({ ...DEFAULT_PROFILE, name: 'dev' });
    await repo.upsertProfile({ ...DEFAULT_PROFILE, name: 'prod' });
    await repo.replaceTableMetadata(
      { connection: 'dev', keyspace: 'ks', table: 't' },
      { name: { hide: true }, tags: { display_type: 'JSON' } },
    );
  });
  afterEach(() => {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("copies the source's metadata to the target table", async () => {
    const data = await importTableMetadata(repo, sourceName, target, false);
    expect(data).toEqual({ name: { hide: true }, tags: { display_type: 'JSON' } });
    expect(await repo.getTableMetadata(prod)).toEqual(data);
  });

  it('refuses to replace existing metadata without overwrite, and replaces it with it', async () => {
    await repo.replaceTableMetadata(prod, { id: { hide: true } });
    await expect(importTableMetadata(repo, sourceName, target, false)).rejects.toThrow(/already exists/);
    expect(await repo.getTableMetadata(prod)).toEqual({ id: { hide: true } });
    await importTableMetadata(repo, sourceName, target, true);
    expect(await repo.getTableMetadata(prod)).toEqual({ name: { hide: true }, tags: { display_type: 'JSON' } });
  });

  it('treats empty existing metadata as nothing to overwrite', async () => {
    await repo.replaceTableMetadata(prod, {});
    await expect(importTableMetadata(repo, sourceName, target, false)).resolves.toBeDefined();
  });

  it('rejects columns the target table does not have', async () => {
    await expect(importTableMetadata(repo, sourceName, { ...target, columns: ['id', 'name'] }, true)).rejects.toThrow(
      /do not exist in ks\.t: tags/,
    );
    expect(await repo.getTableMetadata(prod)).toEqual({});
  });

  it('only accepts per-table file names of tables that have metadata', async () => {
    for (const f of ['../config.json', 'config.json', '../tables/dev-ks.t.json', '/etc/passwd']) {
      await expect(importTableMetadata(repo, f, target, true)).rejects.toThrow(/Not a table metadata file/);
    }
    await expect(importTableMetadata(repo, 'gone-ks.t.json', target, true)).rejects.toThrow(/not found/);
  });
});

describe('import of hand-edited documents', () => {
  it('rejects the wrong shapes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    try {
      const repo = new DocumentRepository(new FileStorage(dir));
      fs.mkdirSync(path.join(dir, 'tables'));
      fs.writeFileSync(path.join(dir, 'tables', 'bad3-ks.t.json'), '{"name":{"hide":"yes"}}');
      fs.writeFileSync(path.join(dir, 'tables', 'bad4-ks.t.json'), '{"name":{"bogus":1}}');
      const target = { connection: 'prod', keyspace: 'ks', table: 't', columns: ['name'] };
      for (const f of ['bad3-ks.t.json', 'bad4-ks.t.json']) {
        await expect(importTableMetadata(repo, f, target, true)).rejects.toThrow(/not valid table metadata/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
