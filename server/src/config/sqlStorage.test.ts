import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBackendName, getSqlConnection, saveBackend } from './backend.js';
import { LocationError } from './location.js';
import { getRepository } from './registry.js';
import { changeStorage, getSetupInfo } from './setup.js';
import { parseConnectionUrl, sameConnection, type SqlConnection } from './sql/connection.js';

const ENV = ['KASSANDRA_HOME', 'KASSANDRA_STORAGE', 'KASSANDRA_DB_URL', 'KASSANDRA_DB_SCHEMA'];

const saved: SqlConnection = {
  dialect: 'mysql',
  host: 'db.example.com',
  port: 3307,
  database: 'kassandra',
  username: 'app',
  password: 'secret',
  ssl: true,
  schema: 'public',
};
const request = { host: '127.0.0.1', port: 1, database: 'db', username: 'u', ssl: false } as const;

describe('parsing a connection URL', () => {
  it('reads every part, with the dialect default port', () => {
    expect(parseConnectionUrl('postgres://u:p%40ss@h:6000/d', 'postgres')).toEqual({
      dialect: 'postgres', host: 'h', port: 6000, database: 'd', username: 'u', password: 'p@ss', ssl: false, schema: 'public',
    });
    expect(parseConnectionUrl('mysql://u@h/d', 'mysql')).toMatchObject({ port: 3306, password: '' });
    expect(parseConnectionUrl('postgresql://u@h/d', 'postgres')).toMatchObject({ port: 5432 });
    expect(parseConnectionUrl('mariadb://u@h/d', 'mysql')).toMatchObject({ host: 'h' });
  });

  it('turns TLS on with ssl=true or any sslmode but disable', () => {
    expect(parseConnectionUrl('mysql://u@h/d?ssl=true', 'mysql').ssl).toBe(true);
    expect(parseConnectionUrl('postgres://u@h/d?sslmode=require', 'postgres').ssl).toBe(true);
    expect(parseConnectionUrl('postgres://u@h/d?sslmode=disable', 'postgres').ssl).toBe(false);
  });

  it('rejects URLs of the wrong kind with a message saying what is expected', () => {
    expect(() => parseConnectionUrl('not a url', 'postgres')).toThrow(/PostgreSQL URL is not valid/);
    expect(() => parseConnectionUrl('mysql://u@h/d', 'postgres')).toThrow(/postgres:\/\/ or postgresql:\/\//);
    expect(() => parseConnectionUrl('postgres://u@h/d', 'mysql')).toThrow(/mysql:\/\/ or mariadb:\/\//);
    expect(() => parseConnectionUrl('postgres://u@h', 'postgres')).toThrow(/database name/);
    expect(() => parseConnectionUrl('postgres://u@h/d%zz', 'postgres')).toThrow(/percent-encoding/);
  });

  it('compares connections, ignoring the schema where there is none', () => {
    expect(sameConnection(saved, { ...saved })).toBe(true);
    expect(sameConnection(saved, { ...saved, schema: 'other' })).toBe(true);
    expect(sameConnection(saved, { ...saved, password: 'x' })).toBe(false);
    expect(sameConnection({ ...saved, dialect: 'postgres' }, { ...saved, dialect: 'postgres', schema: 'other' })).toBe(false);
  });
});

describe('selecting a relational backend (no database needed)', () => {
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

  it('reports PostgreSQL defaults when nothing is configured', () => {
    expect(getSetupInfo()).toMatchObject({
      sqlLocked: false,
      sqlSchemaLocked: false,
      sql: { dialect: 'postgres', host: 'localhost', port: 5432, database: '', username: '', ssl: false, schema: 'public', hasPassword: false },
    });
  });

  it('shows the saved connection without its password', () => {
    saveBackend({ backend: 'mysql', sql: saved });
    expect(getBackendName()).toBe('mysql');
    expect(getSetupInfo().sql).toEqual({
      dialect: 'mysql', host: 'db.example.com', port: 3307, database: 'kassandra', username: 'app', ssl: true, schema: 'public', hasPassword: true,
    });
    expect(JSON.stringify(getSetupInfo())).not.toContain('secret');
  });

  it('remembers the last connection while another backend is active', () => {
    saveBackend({ backend: 'file', sql: saved });
    expect(getSetupInfo().sql).toMatchObject({ dialect: 'mysql', host: 'db.example.com' });
    expect(getSqlConnection('postgres')).toBeNull();
    expect(getSqlConnection('mysql')).toEqual(saved);
  });

  it('ignores a hand-edited pointer with a broken connection', () => {
    saveBackend({ backend: 'mysql', sql: { ...saved, port: -5 } });
    expect(getSqlConnection('mysql')).toBeNull();
  });

  it('lets KASSANDRA_DB_URL and KASSANDRA_DB_SCHEMA win over what was saved, and lock the fields', () => {
    saveBackend({ backend: 'postgres', sql: { ...saved, dialect: 'postgres' } });
    process.env.KASSANDRA_DB_URL = 'postgres://x:other@env.example.com/db2';
    process.env.KASSANDRA_DB_SCHEMA = 'fromenv';
    expect(getSqlConnection('postgres')).toMatchObject({ host: 'env.example.com', password: 'other', schema: 'fromenv' });
    expect(getSetupInfo()).toMatchObject({
      sqlLocked: true,
      sqlSchemaLocked: true,
      sql: { dialect: 'postgres', host: 'env.example.com', database: 'db2', username: 'x', schema: 'fromenv', hasPassword: true },
    });
  });

  it('picks the database to show from the scheme of KASSANDRA_DB_URL while another backend is active', () => {
    process.env.KASSANDRA_DB_URL = 'mysql://u:p@h/d';
    expect(getSetupInfo().sql).toMatchObject({ dialect: 'mysql', host: 'h', database: 'd' });
    process.env.KASSANDRA_DB_URL = 'mariadb://u:p@h/d';
    expect(getSetupInfo().sql.dialect).toBe('mysql');
    process.env.KASSANDRA_DB_URL = 'postgresql://u:p@h/d';
    expect(getSetupInfo().sql.dialect).toBe('postgres');
  });

  it('keeps the pointer file, which holds the password, readable by its owner only', () => {
    saveBackend({ backend: 'mysql', sql: saved });
    const file = path.join(home, '.kassandra', '.backend');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.chmodSync(file, 0o644); // an existing, more permissive file is tightened too
    saveBackend({ backend: 'mysql', sql: saved });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('explains how to configure the backend when it is selected without a connection', () => {
    process.env.KASSANDRA_STORAGE = 'mysql';
    expect(() => getRepository()).toThrow(/"mysql".*KASSANDRA_DB_URL/);
  });

  it('refuses a KASSANDRA_DB_URL meant for the other database', () => {
    process.env.KASSANDRA_STORAGE = 'mysql';
    process.env.KASSANDRA_DB_URL = 'postgres://u@h/d';
    expect(() => getRepository()).toThrow(/mysql:\/\//);
    // Building the page must not crash on it: it shows MySQL with defaults.
    expect(getSetupInfo().sql).toMatchObject({ dialect: 'mysql', host: 'localhost', port: 3306 });
  });

  it('rejects missing or unusable settings with a 400', async () => {
    const bad = [
      undefined,
      { ...request, host: '  ' },
      { ...request, port: 0 },
      { ...request, port: 70000 },
      { ...request, port: 1.5 },
      { ...request, database: '' },
      { ...request, schema: 'a-b; drop' },
    ];
    for (const sql of bad) {
      await expect(changeStorage({ backend: 'postgres', sql })).rejects.toMatchObject({ constructor: LocationError, status: 400 });
    }
    expect(getBackendName()).toBe('file');
    expect(fs.existsSync(path.join(home, '.kassandra', '.backend'))).toBe(false);
  });

  it.each(['postgres', 'mysql'] as const)(
    'fails %s with a 400 that does not leak the password when the server cannot be reached, keeping the old storage',
    async (backend) => {
      const error = await changeStorage({ backend, sql: { ...request, password: 'secret' } }).catch((e) => e);
      expect(error).toBeInstanceOf(LocationError);
      expect(error.status).toBe(400);
      expect(error.message).not.toContain('secret');
      expect(getBackendName()).toBe('file');
      expect(fs.existsSync(path.join(home, '.kassandra', '.backend'))).toBe(false);
    },
  );

  it('cannot be switched to while KASSANDRA_STORAGE fixes the backend', async () => {
    process.env.KASSANDRA_STORAGE = 'file';
    await expect(changeStorage({ backend: 'mysql', sql: request })).rejects.toMatchObject({ status: 409 });
  });
});
