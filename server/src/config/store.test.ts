import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSavedQuery,
  deleteSavedQuery,
  importSavedQueries,
  getTableMetadata,
  listSavedQueries,
  setColumnMetadata,
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

  it('creates, updates and deletes', async () => {
    const q = await createSavedQuery(input);
    expect(await listSavedQueries()).toEqual([q]);
    const updated = await updateSavedQuery(q.id, { ...input, description: 'new' });
    expect(updated).toEqual({ id: q.id, ...input, description: 'new' });
    await deleteSavedQuery(q.id);
    expect(await listSavedQueries()).toEqual([]);
  });

  it('rejects duplicate names and unknown ids', async () => {
    const q = await createSavedQuery(input);
    await expect(createSavedQuery(input)).rejects.toThrow(/already exists/);
    const other = await createSavedQuery({ ...input, name: 'q2' });
    await expect(updateSavedQuery(other.id, input)).rejects.toThrow(/already exists/);
    await expect(updateSavedQuery('nope', input)).rejects.toThrow(/not found/);
    await expect(deleteSavedQuery('nope')).rejects.toThrow(/not found/);
    expect(q.id).not.toBe(other.id);
  });

  it('imports by name, upserting existing', async () => {
    const q = await createSavedQuery(input);
    const r = await importSavedQueries([{ ...input, query: 'SELECT 1' }, { ...input, name: 'q3' }]);
    expect(r).toEqual({ created: 1, updated: 1 });
    const all = await listSavedQueries();
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.name === 'q1')).toMatchObject({ id: q.id, query: 'SELECT 1' });
  });

  it('does not lose concurrent updates', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => createSavedQuery({ ...input, name: `q${i}` })));
    expect(await listSavedQueries()).toHaveLength(25);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => setColumnMetadata('c', 'ks', 't', `col${i}`, { hide: true })),
    );
    expect(Object.keys(await getTableMetadata('c', 'ks', 't'))).toHaveLength(25);
  });
});
