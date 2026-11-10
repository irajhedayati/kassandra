/**
 * How to reach Firestore: the settings, the checks they go through and how the
 * credentials are read (KASSANDRA_FIRESTORE_CREDENTIALS or the Configuration page).
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_FIRESTORE_COLLECTION } from '@kassandra/shared';

export interface FirestoreConnection {
  /** Google Cloud / Firebase project. Defaults to the one in the service account. */
  projectId: string;
  /** Service-account key (the JSON file's content). Empty: Application Default Credentials. A secret: never log it or send it to the browser. */
  credentials: string;
  /** Top-level collection holding the documents. */
  collection: string;
}

const COLLECTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export interface ServiceAccount {
  project_id?: string;
  client_email: string;
  private_key: string;
}

/** Parse a service-account key; throws an Error fit for the user if it is not one. */
export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: Partial<ServiceAccount> | null;
  try {
    parsed = JSON.parse(json) as Partial<ServiceAccount> | null;
  } catch {
    throw new Error('The service-account key is not valid JSON; paste the content of the key file');
  }
  if (!parsed || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('The service-account key must contain client_email and private_key');
  }
  return parsed as ServiceAccount;
}

/** The emulator the SDK talks to instead of Google Cloud, if FIRESTORE_EMULATOR_HOST is set. */
export const emulatorHost = (): string | null => process.env.FIRESTORE_EMULATOR_HOST?.trim() || null;

/** Throws an Error with a message fit for the user if the connection cannot possibly work. Returns it normalised. */
export function validateFirestoreConnection(c: FirestoreConnection): FirestoreConnection {
  const credentials = c.credentials.trim();
  const projectId = c.projectId.trim() || (credentials ? (parseServiceAccount(credentials).project_id ?? '') : '');
  if (credentials) parseServiceAccount(credentials);
  if (!projectId) throw new Error('Enter the Firestore project ID');
  const collection = c.collection.trim() || DEFAULT_FIRESTORE_COLLECTION;
  if (!COLLECTION_NAME.test(collection)) {
    throw new Error(`Invalid collection name "${collection}"; use letters, digits, underscores and dashes, starting with a letter`);
  }
  return { projectId, credentials, collection };
}

/** A key given inline (starts with `{`) or as the path of the key file. */
export function readCredentials(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('{')) return trimmed;
  try {
    return readFileSync(trimmed, 'utf-8').trim();
  } catch (err) {
    throw new Error(`Cannot read the service-account key file ${trimmed}: ${(err as NodeJS.ErrnoException).code ?? err}`);
  }
}

/** Where the data is, for messages. Never includes the credentials. */
export function describeFirestore(c: FirestoreConnection): string {
  return `Firestore project ${c.projectId}, collection ${c.collection}${emulatorHost() ? ` (emulator ${emulatorHost()})` : ''}`;
}

export function sameFirestoreConnection(a: FirestoreConnection, b: FirestoreConnection): boolean {
  return a.projectId === b.projectId && a.credentials === b.credentials && a.collection === b.collection;
}
