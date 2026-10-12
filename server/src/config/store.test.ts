import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSavedQuery,
  deleteSavedQuery,
  importSavedQueries,
  listSavedQueries,
  updateSavedQuery,
} from './store.js';

const input = { name: 'q1', description: 'd', query: 'SELECT * FROM t WHERE id = :id', paramTypes: { id: 'uuid' } };

describe('saved queries', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));
    process.env.KASSANDRA_HOME = dir;
  });
  afterEach(() => {
    delete process.env.KASSANDRA_HOME;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates, updates and deletes', () => {
    const q = createSavedQuery(input);
    expect(listSavedQueries()).toEqual([q]);
    const updated = updateSavedQuery(q.id, { ...input, description: 'new' });
    expect(updated).toEqual({ id: q.id, ...input, description: 'new' });
    deleteSavedQuery(q.id);
    expect(listSavedQueries()).toEqual([]);
  });

  it('rejects duplicate names and unknown ids', () => {
    const q = createSavedQuery(input);
    expect(() => createSavedQuery(input)).toThrow(/already exists/);
    const other = createSavedQuery({ ...input, name: 'q2' });
    expect(() => updateSavedQuery(other.id, input)).toThrow(/already exists/);
    expect(() => updateSavedQuery('nope', input)).toThrow(/not found/);
    expect(() => deleteSavedQuery('nope')).toThrow(/not found/);
    expect(q.id).not.toBe(other.id);
  });

  it('imports by name, upserting existing', () => {
    const q = createSavedQuery(input);
    const r = importSavedQueries([{ ...input, query: 'SELECT 1' }, { ...input, name: 'q3' }]);
    expect(r).toEqual({ created: 1, updated: 1 });
    const all = listSavedQueries();
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.name === 'q1')).toMatchObject({ id: q.id, query: 'SELECT 1' });
  });
});
