import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { FileStorage } from './fileStorage.js';
import { deleteProfile, getTableMetadata, loadSettings, setColumnMetadata, upsertProfile } from './store.js';
import { tableFileName, tableKeyForFile } from './tables.js';

const profile = (name: string) => ({ ...DEFAULT_PROFILE, name });

describe('per-table metadata', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    process.env.KASSANDRA_HOME = dir;
  });
  afterEach(() => {
    delete process.env.KASSANDRA_HOME;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips and merges per column, isolated by connection and table', async () => {
    await loadSettings();
    await setColumnMetadata('c1', 'ks', 't', 'a', { hide: true });
    await setColumnMetadata('c1', 'ks', 't', 'a', { display_type: 'JSON' });
    await setColumnMetadata('c1', 'ks', 't', 'b', { hide: false });
    expect(await getTableMetadata('c1', 'ks', 't')).toEqual({
      a: { hide: true, display_type: 'JSON' },
      b: { hide: false },
    });
    expect(await getTableMetadata('c2', 'ks', 't')).toEqual({});
    expect(await getTableMetadata('c1', 'ks', 'other')).toEqual({});
    expect(fs.readdirSync(path.join(dir, 'tables'))).toEqual(['c1-ks.t.json']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'))).not.toHaveProperty(
      'table_metadata',
    );
  });

  it('encodes unsafe characters so names cannot collide or escape the directory', async () => {
    expect(tableFileName('a-b', 'c', 't')).not.toBe(tableFileName('a', 'b-c', 't'));
    expect(tableKeyForFile(tableFileName('../x', 'k/s', 't'))).toMatch(/^tables\/[A-Za-z0-9_%.-]+$/);
    await setColumnMetadata('my cluster', 'ks', 't', 'a', { hide: true });
    expect(await getTableMetadata('my cluster', 'ks', 't')).toEqual({ a: { hide: true } });
  });

  it('rejects names that are not table metadata files', () => {
    for (const f of ['config.json', '../x.json', 'a-b.json', 'a-b.c.txt']) {
      expect(() => tableKeyForFile(f)).toThrow(/Not a table metadata file/);
    }
  });

  it("deletes a connection's documents with the connection only", async () => {
    await upsertProfile(profile('c1'));
    await upsertProfile(profile('c1-x'));
    await setColumnMetadata('c1', 'ks', 't', 'a', { hide: true });
    await setColumnMetadata('c1-x', 'ks', 't', 'a', { hide: true });
    await deleteProfile('c1');
    expect(await getTableMetadata('c1', 'ks', 't')).toEqual({});
    expect(await getTableMetadata('c1-x', 'ks', 't')).toEqual({ a: { hide: true } });
  });

  it('treats an unreadable document as empty', async () => {
    fs.mkdirSync(path.join(dir, 'tables'));
    fs.writeFileSync(path.join(dir, 'tables', 'c1-ks.t.json'), '{nope');
    expect(await getTableMetadata('c1', 'ks', 't')).toEqual({});
    expect(await new FileStorage(dir).list('tables/')).toEqual(['tables/c1-ks.t']);
  });
});
