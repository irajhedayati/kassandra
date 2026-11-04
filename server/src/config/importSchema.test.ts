import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importTableMetadata } from './importSchema.js';
import {
  listTableFiles,
  parseTableFileName,
  readTableMetadata,
  tableMetadataFile,
  writeTableMetadata,
} from './tables.js';

describe('import table metadata', () => {
  let dir: string;
  const target = { connection: 'prod', keyspace: 'ks', table: 't', columns: ['id', 'name', 'tags'] };
  const sourceName = 'dev-ks.t.json';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    writeTableMetadata(dir, 'dev', 'ks', 't', { name: { hide: true }, tags: { display_type: 'JSON' } });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lists files with their parsed names and column counts, skipping foreign files', () => {
    writeTableMetadata(dir, 'my cluster', 'ks2', 'u', {});
    fs.writeFileSync(path.join(dir, 'tables', 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'tables', 'bad-name.json'), '{}');
    expect(listTableFiles(dir)).toEqual([
      { file: 'dev-ks.t.json', connection: 'dev', keyspace: 'ks', table: 't', columns: 2 },
      { file: 'my%20cluster-ks2.u.json', connection: 'my cluster', keyspace: 'ks2', table: 'u', columns: 0 },
    ]);
    expect(listTableFiles(path.join(dir, 'nope'))).toEqual([]);
  });

  it('parses names back to their parts', () => {
    expect(parseTableFileName(path.basename(tableMetadataFile(dir, 'a-b c', 'k', 't')))).toEqual({
      connection: 'a-b c',
      keyspace: 'k',
      table: 't',
    });
    expect(parseTableFileName('config.json')).toBeNull();
    expect(parseTableFileName('a-b.c.json%')).toBeNull();
  });

  it('copies the file to the target table\'s file', () => {
    const data = importTableMetadata(dir, sourceName, target, false);
    expect(data).toEqual({ name: { hide: true }, tags: { display_type: 'JSON' } });
    expect(readTableMetadata(dir, 'prod', 'ks', 't')).toEqual(data);
    expect(fs.existsSync(tableMetadataFile(dir, 'prod', 'ks', 't'))).toBe(true);
  });

  it('refuses to replace existing metadata without overwrite, and replaces it with it', () => {
    writeTableMetadata(dir, 'prod', 'ks', 't', { id: { hide: true } });
    expect(() => importTableMetadata(dir, sourceName, target, false)).toThrow(/already exists/);
    expect(readTableMetadata(dir, 'prod', 'ks', 't')).toEqual({ id: { hide: true } });
    importTableMetadata(dir, sourceName, target, true);
    expect(readTableMetadata(dir, 'prod', 'ks', 't')).toEqual({
      name: { hide: true },
      tags: { display_type: 'JSON' },
    });
  });

  it('treats empty existing metadata as nothing to overwrite', () => {
    writeTableMetadata(dir, 'prod', 'ks', 't', {});
    expect(() => importTableMetadata(dir, sourceName, target, false)).not.toThrow();
  });

  it('rejects columns the target table does not have', () => {
    expect(() =>
      importTableMetadata(dir, sourceName, { ...target, columns: ['id', 'name'] }, true),
    ).toThrow(/do not exist in ks\.t: tags/);
    expect(readTableMetadata(dir, 'prod', 'ks', 't')).toEqual({});
  });

  it('rejects invalid JSON and wrong shapes', () => {
    const bad = (name: string, content: string) =>
      fs.writeFileSync(path.join(dir, 'tables', name), content);
    bad('bad1-ks.t.json', '{nope');
    bad('bad2-ks.t.json', '[1]');
    bad('bad3-ks.t.json', '{"name":{"hide":"yes"}}');
    bad('bad4-ks.t.json', '{"name":{"bogus":1}}');
    expect(() => importTableMetadata(dir, 'bad1-ks.t.json', target, true)).toThrow(/not valid JSON/);
    for (const f of ['bad2-ks.t.json', 'bad3-ks.t.json', 'bad4-ks.t.json']) {
      expect(() => importTableMetadata(dir, f, target, true)).toThrow(/not valid table metadata/);
    }
  });

  it('only accepts plain per-table file names', () => {
    for (const f of ['../config.json', 'config.json', '../tables/dev-ks.t.json', '/etc/passwd']) {
      expect(() => importTableMetadata(dir, f, target, true)).toThrow(/Not a table metadata file/);
    }
    expect(() => importTableMetadata(dir, 'gone-ks.t.json', target, true)).toThrow(/not found/);
  });
});
