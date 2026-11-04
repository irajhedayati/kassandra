import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from './fileStorage.js';
import { importTableMetadata } from './importSchema.js';
import {
  listTableFiles,
  parseTableFileName,
  readTableMetadata,
  tableFileName,
  writeTableMetadata,
} from './tables.js';

describe('import table metadata', () => {
  let dir: string;
  let storage: FileStorage;
  const target = { connection: 'prod', keyspace: 'ks', table: 't', columns: ['id', 'name', 'tags'] };
  const sourceName = 'dev-ks.t.json';
  const tablePath = (name: string) => path.join(dir, 'tables', name);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    storage = new FileStorage(dir);
    await writeTableMetadata(storage, 'dev', 'ks', 't', {
      name: { hide: true },
      tags: { display_type: 'JSON' },
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lists files with their parsed names and column counts, skipping foreign files', async () => {
    await writeTableMetadata(storage, 'my cluster', 'ks2', 'u', {});
    fs.writeFileSync(tablePath('notes.txt'), 'x');
    fs.writeFileSync(tablePath('bad-name.json'), '{}');
    expect(await listTableFiles(storage)).toEqual([
      { file: 'dev-ks.t.json', connection: 'dev', keyspace: 'ks', table: 't', columns: 2 },
      { file: 'my%20cluster-ks2.u.json', connection: 'my cluster', keyspace: 'ks2', table: 'u', columns: 0 },
    ]);
    expect(await listTableFiles(new FileStorage(path.join(dir, 'nope')))).toEqual([]);
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

  it("copies the file to the target table's document", async () => {
    const data = await importTableMetadata(storage, sourceName, target, false);
    expect(data).toEqual({ name: { hide: true }, tags: { display_type: 'JSON' } });
    expect(await readTableMetadata(storage, 'prod', 'ks', 't')).toEqual(data);
    expect(fs.existsSync(tablePath('prod-ks.t.json'))).toBe(true);
  });

  it('refuses to replace existing metadata without overwrite, and replaces it with it', async () => {
    await writeTableMetadata(storage, 'prod', 'ks', 't', { id: { hide: true } });
    await expect(importTableMetadata(storage, sourceName, target, false)).rejects.toThrow(/already exists/);
    expect(await readTableMetadata(storage, 'prod', 'ks', 't')).toEqual({ id: { hide: true } });
    await importTableMetadata(storage, sourceName, target, true);
    expect(await readTableMetadata(storage, 'prod', 'ks', 't')).toEqual({
      name: { hide: true },
      tags: { display_type: 'JSON' },
    });
  });

  it('treats empty existing metadata as nothing to overwrite', async () => {
    await writeTableMetadata(storage, 'prod', 'ks', 't', {});
    await expect(importTableMetadata(storage, sourceName, target, false)).resolves.toBeDefined();
  });

  it('rejects columns the target table does not have', async () => {
    await expect(
      importTableMetadata(storage, sourceName, { ...target, columns: ['id', 'name'] }, true),
    ).rejects.toThrow(/do not exist in ks\.t: tags/);
    expect(await readTableMetadata(storage, 'prod', 'ks', 't')).toEqual({});
  });

  it('rejects invalid JSON and wrong shapes', async () => {
    const bad = (name: string, content: string) => fs.writeFileSync(tablePath(name), content);
    bad('bad1-ks.t.json', '{nope');
    bad('bad2-ks.t.json', '[1]');
    bad('bad3-ks.t.json', '{"name":{"hide":"yes"}}');
    bad('bad4-ks.t.json', '{"name":{"bogus":1}}');
    await expect(importTableMetadata(storage, 'bad1-ks.t.json', target, true)).rejects.toThrow(/not valid JSON/);
    for (const f of ['bad2-ks.t.json', 'bad3-ks.t.json', 'bad4-ks.t.json']) {
      await expect(importTableMetadata(storage, f, target, true)).rejects.toThrow(/not valid table metadata/);
    }
  });

  it('only accepts plain per-table file names', async () => {
    for (const f of ['../config.json', 'config.json', '../tables/dev-ks.t.json', '/etc/passwd']) {
      await expect(importTableMetadata(storage, f, target, true)).rejects.toThrow(/Not a table metadata file/);
    }
    await expect(importTableMetadata(storage, 'gone-ks.t.json', target, true)).rejects.toThrow(/not found/);
  });
});
