import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBackendName, getPostgresSchema, getPostgresUrl, maskPostgresUrl, saveBackend } from './backend.js';
import { LocationError } from './location.js';
import { getRepository } from './registry.js';
import { changeStorage, getSetupInfo } from './setup.js';

const ENV = ['KASSANDRA_HOME', 'KASSANDRA_STORAGE', 'KASSANDRA_PG_URL', 'KASSANDRA_PG_SCHEMA'];

describe('selecting the PostgreSQL backend (no database needed)', () => {
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

  it('masks the password of a URL and leaves URLs without one alone', () => {
    expect(maskPostgresUrl('postgres://u:secret@h:5432/db')).toBe('postgres://u:***@h:5432/db');
    expect(maskPostgresUrl('postgres://h/db')).toBe('postgres://h/db');
    expect(maskPostgresUrl('')).toBe('');
  });

  it('reports no URL and the public schema by default', () => {
    expect(getSetupInfo()).toMatchObject({
      postgresUrl: '',
      postgresUrlLocked: false,
      postgresSchema: 'public',
      postgresSchemaLocked: false,
    });
  });

  it('shows the saved URL masked, and the environment wins over what was saved', () => {
    saveBackend({ backend: 'postgres', postgresUrl: 'postgres://u:secret@h/db', postgresSchema: 'mine' });
    expect(getBackendName()).toBe('postgres');
    expect(getPostgresUrl()).toBe('postgres://u:secret@h/db');
    expect(getSetupInfo()).toMatchObject({ postgresUrl: 'postgres://u:***@h/db', postgresSchema: 'mine' });
    expect(JSON.stringify(getSetupInfo())).not.toContain('secret');

    process.env.KASSANDRA_PG_URL = 'postgres://x:other@env/db2';
    process.env.KASSANDRA_PG_SCHEMA = 'fromenv';
    expect(getSetupInfo()).toMatchObject({
      postgresUrl: 'postgres://x:***@env/db2',
      postgresUrlLocked: true,
      postgresSchema: 'fromenv',
      postgresSchemaLocked: true,
    });
  });

  it('keeps the pointer file, which may hold a password, readable by its owner only', () => {
    saveBackend({ backend: 'postgres', postgresUrl: 'postgres://u:secret@h/db' });
    const file = path.join(home, '.kassandra', '.backend');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // An existing, more permissive file is tightened too.
    fs.chmodSync(file, 0o644);
    saveBackend({ backend: 'postgres', postgresUrl: 'postgres://u:secret@h/db' });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('explains how to configure the backend when it is selected without a URL', () => {
    process.env.KASSANDRA_STORAGE = 'postgres';
    expect(() => getRepository()).toThrow(/KASSANDRA_PG_URL/);
  });

  it('rejects a missing, malformed or non-PostgreSQL URL with a 400', async () => {
    for (const postgresUrl of [undefined, '   ', 'not a url', 'mysql://u:p@h/db']) {
      await expect(changeStorage({ backend: 'postgres', postgresUrl })).rejects.toMatchObject({
        constructor: LocationError,
        status: 400,
      });
    }
    expect(getBackendName()).toBe('file');
  });

  it('rejects an invalid schema name', async () => {
    await expect(
      changeStorage({ backend: 'postgres', postgresUrl: 'postgres://u:secret@127.0.0.1:1/db', postgresSchema: 'a-b; drop' }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Invalid PostgreSQL schema name/) });
  });

  it('fails with a 400 that does not leak the password when the server cannot be reached, and keeps the old storage', async () => {
    const error = await changeStorage({ backend: 'postgres', postgresUrl: 'postgres://u:secret@127.0.0.1:1/db' }).catch((e) => e);
    expect(error).toBeInstanceOf(LocationError);
    expect(error.status).toBe(400);
    expect(error.message).not.toContain('secret');
    expect(getBackendName()).toBe('file');
    expect(fs.existsSync(path.join(home, '.kassandra', '.backend'))).toBe(false);
  });

  it('cannot be switched to or from while KASSANDRA_STORAGE fixes the backend', async () => {
    process.env.KASSANDRA_STORAGE = 'file';
    await expect(changeStorage({ backend: 'postgres', postgresUrl: 'postgres://u:p@h/db' })).rejects.toMatchObject({ status: 409 });
  });
});
