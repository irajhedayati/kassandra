/**
 * Support for the Firestore integration tests (`*.integration.test.ts`).
 * `npm run test:integration` starts the Firestore emulator and sets
 * FIRESTORE_EMULATOR_HOST; the SDK then talks to it without credentials.
 * Each test works in a collection of its own and deletes it afterwards.
 */
import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { FirestoreConnection } from './connection.js';

export const TEST_PROJECT = 'kassandra-test';

/** Throws if there is no emulator, so a forgotten setup is not a silent pass. */
export function emulatorOrThrow(): string {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set; run `npm run test:integration -w @kassandra/server`');
  return host;
}

export interface TestCollection {
  connection: FirestoreConnection;
  /** Names of the documents in the collection. */
  documents(): Promise<string[]>;
  drop(): Promise<void>;
}

export function createTestCollection(): TestCollection {
  emulatorOrThrow();
  const collection = `kassandra_test_${crypto.randomBytes(6).toString('hex')}`;
  const db = new Firestore({ projectId: TEST_PROJECT });
  return {
    connection: { projectId: TEST_PROJECT, credentials: '', collection },
    documents: async () => (await db.collection(collection).select().get()).docs.map((d) => d.id).sort(),
    drop: async () => {
      await db.recursiveDelete(db.collection(collection));
      await db.terminate();
    },
  };
}
