/**
 * Behaviour every ConfigStorage implementation must have. A connector's test
 * file calls describeStorageContract() with a factory for a fresh, empty storage.
 */
import { describe, expect, it } from 'vitest';
import type { ConfigStorage } from './storage.js';

export interface StorageHarness {
  storage: ConfigStorage;
  cleanup(): Promise<void> | void;
}

export function describeStorageContract(name: string, create: () => Promise<StorageHarness> | StorageHarness): void {
  describe(`ConfigStorage contract: ${name}`, () => {
    const withStorage = async (fn: (s: ConfigStorage) => Promise<void>) => {
      const h = await create();
      try {
        await fn(h.storage);
      } finally {
        await h.cleanup();
      }
    };

    it('returns undefined for a missing key', () =>
      withStorage(async (s) => {
        expect(await s.get('config')).toBeUndefined();
        expect(await s.get('tables/a-b.c')).toBeUndefined();
      }));

    it('round-trips JSON documents and overwrites them', () =>
      withStorage(async (s) => {
        const doc = { a: [1, 2, { b: null }], c: 'x', d: { e: true } };
        await s.put('config', doc);
        expect(await s.get('config')).toEqual(doc);
        await s.put('config', { replaced: 1 });
        expect(await s.get('config')).toEqual({ replaced: 1 });
      }));

    it('keeps keys with slashes apart', () =>
      withStorage(async (s) => {
        await s.put('tables/a-b.c', { n: 1 });
        await s.put('tables/a-b.d', { n: 2 });
        await s.put('backups/1.5.0/tables/a-b.c', { n: 3 });
        expect(await s.get('tables/a-b.c')).toEqual({ n: 1 });
        expect(await s.get('backups/1.5.0/tables/a-b.c')).toEqual({ n: 3 });
      }));

    it('deletes keys and ignores missing ones', () =>
      withStorage(async (s) => {
        await s.put('config', {});
        await s.delete('config');
        await s.delete('config');
        expect(await s.get('config')).toBeUndefined();
      }));

    it('lists keys by prefix, sorted', () =>
      withStorage(async (s) => {
        expect(await s.list('')).toEqual([]);
        for (const key of ['tables/b-x.y', 'config', 'tables/a-x.y', 'backups/1.5.0/config']) {
          await s.put(key, {});
        }
        expect(await s.list('')).toEqual(['backups/1.5.0/config', 'config', 'tables/a-x.y', 'tables/b-x.y']);
        expect(await s.list('tables/')).toEqual(['tables/a-x.y', 'tables/b-x.y']);
        expect(await s.list('nope/')).toEqual([]);
      }));

    it('keeps the version apart from the documents', () =>
      withStorage(async (s) => {
        expect(await s.getVersion()).toBeNull();
        await s.setVersion('1.6.0');
        expect(await s.getVersion()).toBe('1.6.0');
        await s.setVersion('1.7.0');
        expect(await s.getVersion()).toBe('1.7.0');
        expect(await s.list('')).toEqual([]);
      }));

    it('locks exclusively until released', () =>
      withStorage(async (s) => {
        const release = await s.lock();
        await expect(s.lock({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
        await release();
        const again = await s.lock({ timeoutMs: 300 });
        await again();
      }));

    it('waits for the holder to release', () =>
      withStorage(async (s) => {
        const release = await s.lock();
        setTimeout(() => void release(), 150);
        const next = await s.lock({ timeoutMs: 3000 });
        await next();
      }));

    it('takes over a stale lock', () =>
      withStorage(async (s) => {
        await s.lock();
        const next = await s.lock({ timeoutMs: 3000, staleMs: 50 });
        await next();
      }));
  });
}
