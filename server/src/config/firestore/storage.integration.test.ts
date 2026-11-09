/**
 * FirestoreStorage, and the repository built on it, against the Firestore
 * emulator. Run with `npm run test:integration -w @kassandra/server`, which
 * starts the emulator and sets FIRESTORE_EMULATOR_HOST; plain `npm test` skips
 * these files. See testing.ts.
 */
import { describe, expect, it } from 'vitest';
import { DocumentRepository } from '../documentRepository.js';
import { describeRepositoryContract } from '../repository.contract.js';
import { describeStorageContract } from '../storage.contract.js';
import { FirestoreStorage } from './storage.js';
import { createTestCollection } from './testing.js';

const open = () => {
  const collection = createTestCollection();
  const storage = new FirestoreStorage(collection.connection);
  return { collection, storage, cleanup: async () => (await storage.close(), collection.drop()) };
};

describeStorageContract('FirestoreStorage', () => {
  const { storage, cleanup } = open();
  return { storage, cleanup };
});

describeRepositoryContract('DocumentRepository on Firestore', () => {
  const { storage, cleanup } = open();
  return { repository: new DocumentRepository(storage), cleanup };
});

describe('FirestoreStorage', () => {
  it('keeps one document per key, the version and the lock apart from them', async () => {
    const { collection, storage, cleanup } = open();
    try {
      await storage.put('config', { a: 1 });
      await storage.put('tables/p-ks.t', { c: [[1, 2], [3]] });
      await storage.setVersion('1.6.0');
      const release = await storage.lock();
      expect(await collection.documents()).toEqual(['@lock', '@version', 'config', 'tables~p-ks.t']);
      expect(await storage.list('')).toEqual(['config', 'tables/p-ks.t']);
      // Nested arrays are not storable as Firestore fields, but are valid JSON.
      expect(await storage.get('tables/p-ks.t')).toEqual({ c: [[1, 2], [3]] });
      await release();
      expect(await collection.documents()).not.toContain('@lock');
    } finally {
      await cleanup();
    }
  });

  it('does not release a lock that was taken over', async () => {
    const { storage, cleanup } = open();
    try {
      const first = await storage.lock();
      const second = await storage.lock({ staleMs: 0, timeoutMs: 3000 });
      await first();
      await expect(storage.lock({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
      await second();
    } finally {
      await cleanup();
    }
  });

  it('keeps collections apart', async () => {
    const a = open();
    const b = open();
    try {
      await a.storage.put('config', { from: 'a' });
      expect(await b.storage.get('config')).toBeUndefined();
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
