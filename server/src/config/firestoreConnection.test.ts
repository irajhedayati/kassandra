import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBackendName, getFirestoreConnection, saveBackend } from './backend.js';
import { LocationError } from './location.js';
import { getRepository } from './registry.js';
import { changeStorage, getSetupInfo } from './setup.js';
import { parseServiceAccount, readCredentials, validateFirestoreConnection } from './firestore/connection.js';

const ENV = ['KASSANDRA_HOME', 'KASSANDRA_STORAGE', 'KASSANDRA_FIRESTORE_PROJECT', 'KASSANDRA_FIRESTORE_CREDENTIALS', 'KASSANDRA_FIRESTORE_COLLECTION'];

const key = JSON.stringify({ project_id: 'from-key', client_email: 'svc@from-key.iam.gserviceaccount.com', private_key: 'SECRET-KEY' });

describe('Firestore connection settings', () => {
  let home: string;
  const savedHome = process.env.HOME;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    process.env.HOME = home;
    for (const name of ENV) delete process.env[name];
  });
  afterEach(() => {
    process.env.HOME = savedHome;
    for (const name of ENV) delete process.env[name];
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('defaults the project to the service account’s and the collection to "kassandra"', () => {
    expect(validateFirestoreConnection({ projectId: '', credentials: key, collection: '' })).toEqual({
      projectId: 'from-key',
      credentials: key,
      collection: 'kassandra',
    });
  });

  it('rejects a missing project, a bad collection and a malformed key', () => {
    expect(() => validateFirestoreConnection({ projectId: '', credentials: '', collection: '' })).toThrow(/project ID/);
    expect(() => validateFirestoreConnection({ projectId: 'p', credentials: '', collection: 'a/b' })).toThrow(/collection/);
    expect(() => validateFirestoreConnection({ projectId: 'p', credentials: 'nope', collection: '' })).toThrow(/JSON/);
    expect(() => parseServiceAccount('{"client_email":"x"}')).toThrow(/private_key/);
  });

  it('reads the key inline or from a file', () => {
    const file = path.join(home, 'key.json');
    fs.writeFileSync(file, `${key}\n`);
    expect(readCredentials(key)).toBe(key);
    expect(readCredentials(file)).toBe(key);
    expect(() => readCredentials(path.join(home, 'missing.json'))).toThrow(/Cannot read/);
  });

  it('lets KASSANDRA_FIRESTORE_* override the saved settings', () => {
    saveBackend({ backend: 'firestore', firestore: { projectId: 'saved', credentials: key, collection: 'saved_col' } });
    expect(getFirestoreConnection()).toMatchObject({ projectId: 'saved', collection: 'saved_col' });
    process.env.KASSANDRA_FIRESTORE_COLLECTION = 'env_col';
    expect(getFirestoreConnection()).toEqual({ projectId: 'saved', credentials: key, collection: 'env_col' });
  });

  it('never exposes the key, and saves it where only the user can read it', async () => {
    saveBackend({ backend: 'firestore', firestore: { projectId: 'p', credentials: key, collection: 'c' } });
    expect(fs.statSync(path.join(home, '.kassandra', '.backend')).mode & 0o777).toBe(0o600);
    expect(getBackendName()).toBe('firestore');
    const info = getSetupInfo();
    expect(info.firestore).toEqual({ projectId: 'p', collection: 'c', hasCredentials: true, clientEmail: 'svc@from-key.iam.gserviceaccount.com' });
    expect(JSON.stringify(info)).not.toContain('SECRET-KEY');
  });

  it('reports what is missing when selected without settings', () => {
    process.env.KASSANDRA_STORAGE = 'firestore';
    expect(() => getRepository()).toThrow(/KASSANDRA_FIRESTORE_PROJECT/);
  });

  it('refuses invalid settings before touching anything', async () => {
    const error = await changeStorage({ backend: 'firestore', firestore: { projectId: '', credentials: '' } }).catch((e) => e);
    expect(error).toBeInstanceOf(LocationError);
    expect(error).toMatchObject({ status: 400 });
    expect(getBackendName()).toBe('file');
  });
});
