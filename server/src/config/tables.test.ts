import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProfile,
  getTableMetadata,
  loadSettings,
  setColumnMetadata,
  upsertProfile,
} from './store.js';
import { tableMetadataFile } from './tables.js';
import { DEFAULT_PROFILE } from '@kassandra/shared';

const profile = (name: string) => ({ ...DEFAULT_PROFILE, name });

describe('per-table metadata files', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    process.env.KASSANDRA_HOME = dir;
  });
  afterEach(() => {
    delete process.env.KASSANDRA_HOME;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips and merges per column, isolated by connection and table', () => {
    loadSettings();
    setColumnMetadata('c1', 'ks', 't', 'a', { hide: true });
    setColumnMetadata('c1', 'ks', 't', 'a', { display_type: 'JSON' });
    setColumnMetadata('c1', 'ks', 't', 'b', { hide: false });
    expect(getTableMetadata('c1', 'ks', 't')).toEqual({
      a: { hide: true, display_type: 'JSON' },
      b: { hide: false },
    });
    expect(getTableMetadata('c2', 'ks', 't')).toEqual({});
    expect(getTableMetadata('c1', 'ks', 'other')).toEqual({});
    expect(fs.readdirSync(path.join(dir, 'tables'))).toEqual(['c1-ks.t.json']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'))).not.toHaveProperty(
      'table_metadata',
    );
  });

  it('encodes unsafe characters so names cannot collide or escape the directory', () => {
    const a = tableMetadataFile(dir, 'a-b', 'c', 't');
    const b = tableMetadataFile(dir, 'a', 'b-c', 't');
    expect(a).not.toBe(b);
    const evil = tableMetadataFile(dir, '../x', 'k/s', 't');
    expect(path.dirname(evil)).toBe(path.join(dir, 'tables'));
    setColumnMetadata('my cluster', 'ks', 't', 'a', { hide: true });
    expect(getTableMetadata('my cluster', 'ks', 't')).toEqual({ a: { hide: true } });
  });

  it('deletes a connection\'s files with the connection only', () => {
    upsertProfile(profile('c1'));
    upsertProfile(profile('c1-x'));
    setColumnMetadata('c1', 'ks', 't', 'a', { hide: true });
    setColumnMetadata('c1-x', 'ks', 't', 'a', { hide: true });
    deleteProfile('c1');
    expect(getTableMetadata('c1', 'ks', 't')).toEqual({});
    expect(getTableMetadata('c1-x', 'ks', 't')).toEqual({ a: { hide: true } });
  });
});
