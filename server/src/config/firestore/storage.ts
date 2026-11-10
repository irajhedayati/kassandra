/**
 * ConfigStorage backed by Firestore. Every key is one document in a single
 * collection: `config` and `tables/<conn>-<ks>.<table>` map to the document ids
 * `config` and `tables~<conn>-<ks>.<table>` (a document id cannot contain `/`,
 * and `~` is not allowed in keys, so the mapping is reversible). The JSON is
 * kept as a string in the `json` field because Firestore rejects nested
 * arrays and some field names. The version and the lock are documents with an
 * `@` prefix, which no key can have.
 */
import { Firestore, type Settings } from '@google-cloud/firestore';
import { randomUUID } from 'node:crypto';
import { keySegments } from '../keys.js';
import type { ConfigStorage, LockOptions } from '../storage.js';
import {
  describeFirestore,
  parseServiceAccount,
  sameFirestoreConnection,
  validateFirestoreConnection,
  type FirestoreConnection,
} from './connection.js';

const VERSION_DOC = '@version';
const LOCK_DOC = '@lock';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const docId = (key: string) => keySegments(key).join('~');
const keyOf = (id: string) => id.replaceAll('~', '/');

export class FirestoreStorage implements ConfigStorage {
  readonly db: Firestore;

  constructor(readonly connection: FirestoreConnection) {
    const settings: Settings = { projectId: connection.projectId };
    if (connection.credentials) {
      const { client_email, private_key } = parseServiceAccount(connection.credentials);
      settings.credentials = { client_email, private_key };
    }
    this.db = new Firestore(settings);
  }

  get description(): string {
    return describeFirestore(this.connection);
  }

  private doc(id: string) {
    return this.db.collection(this.connection.collection).doc(id);
  }

  async get(key: string): Promise<unknown | undefined> {
    const snapshot = await this.doc(docId(key)).get();
    return snapshot.exists ? JSON.parse(snapshot.get('json') as string) : undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.doc(docId(key)).set({ json: JSON.stringify(value), updatedAt: Date.now() });
  }

  async delete(key: string): Promise<void> {
    await this.doc(docId(key)).delete();
  }

  async list(prefix: string): Promise<string[]> {
    const snapshot = await this.db.collection(this.connection.collection).select().get();
    return snapshot.docs
      .map((d) => d.id)
      .filter((id) => !id.startsWith('@'))
      .map(keyOf)
      .filter((k) => k.startsWith(prefix))
      .sort();
  }

  async getVersion(): Promise<string | null> {
    const snapshot = await this.doc(VERSION_DOC).get();
    return snapshot.exists ? ((snapshot.get('version') as string) || null) : null;
  }

  async setVersion(version: string): Promise<void> {
    await this.doc(VERSION_DOC).set({ version });
  }

  async lock({ timeoutMs = 60_000, staleMs = 300_000 }: LockOptions = {}): Promise<() => Promise<void>> {
    const ref = this.doc(LOCK_DOC);
    const owner = randomUUID();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const taken = await this.db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const heldSince = snapshot.exists ? (snapshot.get('acquiredAt') as number) : null;
        if (heldSince !== null && Date.now() - heldSince <= staleMs) return false;
        if (heldSince !== null) console.warn('[kassandra] removing stale lock');
        tx.set(ref, { owner, acquiredAt: Date.now() });
        return true;
      });
      if (taken) {
        return () =>
          this.db.runTransaction(async (tx) => {
            // Only release our own lock: after a stale takeover it belongs to someone else.
            if ((await tx.get(ref)).get('owner') === owner) tx.delete(ref);
          });
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for another process to release the lock in ${this.description}`);
      }
      await sleep(200);
    }
  }

  /** Release the gRPC channels. The storage must not be used afterwards. */
  async close(): Promise<void> {
    await this.db.terminate();
  }
}

let shared: FirestoreStorage | null = null;

/** The process-wide client for `connection`; switching to another project or collection closes the previous one. */
export function sharedFirestoreStorage(connection: FirestoreConnection): FirestoreStorage {
  const valid = validateFirestoreConnection(connection);
  if (!shared || !sameFirestoreConnection(shared.connection, valid)) {
    void shared?.close();
    shared = new FirestoreStorage(valid);
  }
  return shared;
}

/** Close the shared client (it is reopened on demand). */
export function closeSharedFirestoreStorage(): void {
  void shared?.close();
  shared = null;
}
