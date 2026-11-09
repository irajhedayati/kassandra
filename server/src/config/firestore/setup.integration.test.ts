/**
 * Switching the storage to Firestore from the Configuration page, against the
 * emulator. See storage.integration.test.ts for how these are run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { getBackendName } from '../backend.js';
import { DocumentRepository } from '../documentRepository.js';
import { FileStorage } from '../fileStorage.js';
import { getRepository } from '../registry.js';
import { changeStorage, getSetupInfo } from '../setup.js';
import { closeSharedFirestoreStorage } from './storage.js';
import { createTestCollection, type TestCollection } from './testing.js';

const ENV = ['KASSANDRA_HOME', 'KASSANDRA_STORAGE', 'KASSANDRA_FIRESTORE_PROJECT', 'KASSANDRA_FIRESTORE_CREDENTIALS', 'KASSANDRA_FIRESTORE_COLLECTION'];

describe('switching the storage to Firestore', () => {
  let home: string;
  let test: TestCollection;
  const savedHome = process.env.HOME;
  const t = { connection: 'p', keyspace: 'ks', table: 't' };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    process.env.HOME = home;
    for (const name of ENV) delete process.env[name];
    test = createTestCollection();
  });
  afterEach(async () => {
    closeSharedFirestoreStorage();
    process.env.HOME = savedHome;
    for (const name of ENV) delete process.env[name];
    fs.rmSync(home, { recursive: true, force: true });
    await test.drop();
  });

  const settings = () => ({ projectId: test.connection.projectId, collection: test.connection.collection });

  const seedFiles = async () => {
    const files = new DocumentRepository(new FileStorage(path.join(home, '.kassandra')));
    await files.migrate();
    await files.upsertProfile({ ...DEFAULT_PROFILE, name: 'p', hosts: ['h1', 'h2'] });
    await files.setColumnMetadata(t, 'c', { hide: true });
    await files.createSavedQuery({ name: 'q', description: '', query: 'SELECT 1', paramTypes: {} });
  };

  it('copies the JSON configuration into Firestore and uses it from then on', async () => {
    await seedFiles();
    const result = await changeStorage({ backend: 'firestore', firestore: settings() });
    expect(result).toMatchObject({
      backend: 'firestore',
      copied: 3,
      existing: false,
      firestore: { projectId: test.connection.projectId, collection: test.connection.collection, hasCredentials: false },
    });
    expect(getBackendName()).toBe('firestore');
    expect(await test.documents()).toEqual(['@version', 'config', 'tables~p-ks.t']);

    const active = getRepository();
    expect((await active.listProfiles()).map((p) => p.name)).toEqual(['p']);
    expect((await active.listSavedQueries()).map((q) => q.name)).toEqual(['q']);
    expect(await active.getTableMetadata(t)).toEqual({ c: { hide: true } });
  });

  it('uses a collection that already holds a configuration as is', async () => {
    await seedFiles();
    await changeStorage({ backend: 'firestore', firestore: settings() });
    await getRepository().upsertProfile({ ...DEFAULT_PROFILE, name: 'only-in-firestore' });
    await changeStorage({ backend: 'file' });

    const result = await changeStorage({ backend: 'firestore', firestore: settings() });
    expect(result).toMatchObject({ existing: true, copied: 0 });
    expect((await getRepository().listProfiles()).map((p) => p.name)).toContain('only-in-firestore');
  });

  it('switches back to the files, which are untouched', async () => {
    await seedFiles();
    await changeStorage({ backend: 'firestore', firestore: settings() });
    await changeStorage({ backend: 'file' });
    expect(getBackendName()).toBe('file');
    expect((await getRepository().listProfiles()).map((p) => p.name)).toEqual(['p']);
  });

  it('is configured by KASSANDRA_FIRESTORE_*, which fix the settings', async () => {
    await seedFiles();
    process.env.KASSANDRA_FIRESTORE_PROJECT = test.connection.projectId;
    process.env.KASSANDRA_FIRESTORE_COLLECTION = test.connection.collection;
    expect(getSetupInfo()).toMatchObject({ firestoreLocked: true, firestore: { collection: test.connection.collection } });
    await changeStorage({ backend: 'firestore' });
    expect(await getRepository().listProfiles()).toHaveLength(1);
  });
});
