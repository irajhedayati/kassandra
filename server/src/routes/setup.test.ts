import fs from 'node:fs';
import http from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { initSetupState } from '../config/setup.js';
import { closeSharedSqliteRepository } from '../config/sqlite/repository.js';

describe('/api/setup (first-run flow through the Express app)', () => {
  let home: string;
  let work: string;
  const app = createApp();
  const savedHome = process.env.HOME;

  // Sandboxes may forbid listening sockets, so feed the app a fake request and capture the response.
  const call = (method: string, url: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const req = new http.IncomingMessage(new Socket());
      req.method = method;
      req.url = url;
      req.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) };
      if (payload) req.push(payload);
      req.push(null);
      const res = new http.ServerResponse(req);
      res.end = ((chunk?: unknown) => {
        resolve({ status: res.statusCode, json: chunk ? JSON.parse(String(chunk)) : undefined });
        return res;
      }) as typeof res.end;
      (app as unknown as http.RequestListener)(req, res);
    });

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-home-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-work-'));
    process.env.HOME = home;
    delete process.env.KASSANDRA_HOME;
    delete process.env.KASSANDRA_STORAGE;
    initSetupState();
  });
  afterEach(() => {
    closeSharedSqliteRepository();
    process.env.HOME = savedHome;
    delete process.env.KASSANDRA_HOME;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('reports a first run with the default location', async () => {
    const { status, json } = await call('GET', '/api/setup');
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      firstRun: true,
      location: path.join(home, '.kassandra'),
      defaultLocation: path.join(home, '.kassandra'),
      locked: false,
    });
  });

  it('rejects a malformed body', async () => {
    const { status } = await call('PUT', '/api/setup/location', { nope: 1 });
    expect(status).toBe(400);
  });

  it('rejects a location that is a file, with a clear message', async () => {
    const file = path.join(work, 'afile');
    fs.writeFileSync(file, '');
    const { status, json } = await call('PUT', '/api/setup/location', { location: file });
    expect(status).toBe(400);
    expect(JSON.stringify(json)).toContain('Cannot use');
    expect((await call('GET', '/api/setup')).json.data.location).toBe(path.join(home, '.kassandra'));
  });

  it('rejects an unwritable location', async () => {
    const dir = path.join(work, 'ro');
    fs.mkdirSync(dir, { mode: 0o500 });
    const { status, json } = await call('PUT', '/api/setup/location', { location: path.join(dir, 'cfg') });
    expect(status).toBe(400);
    expect(JSON.stringify(json)).toContain('Cannot use');
  });

  it('switches to a valid location and persists the pointer', async () => {
    const target = path.join(work, 'newcfg');
    const { status } = await call('PUT', '/api/setup/location', { location: target });
    expect(status).toBe(200);
    const info = (await call('GET', '/api/setup')).json.data;
    expect(info.location).toBe(target);
    expect(info.firstRun).toBe(false);
    expect(fs.readFileSync(path.join(home, '.kassandra', '.location'), 'utf-8')).toContain(target);
  });

  it('refuses to change the location when KASSANDRA_HOME is set', async () => {
    process.env.KASSANDRA_HOME = path.join(work, 'fixed');
    const info = (await call('GET', '/api/setup')).json.data;
    expect(info).toMatchObject({ locked: true, location: path.join(work, 'fixed') });
    const { status } = await call('PUT', '/api/setup/location', { location: path.join(work, 'other') });
    expect(status).toBe(409);
  });

  it('switches to SQLite over PUT /storage and rejects bad requests', async () => {
    const bad = await call('PUT', '/api/setup/storage', { backend: 'redis' });
    expect(bad.status).toBe(400);

    const db = path.join(work, 'k.db');
    const { status, json } = await call('PUT', '/api/setup/storage', { backend: 'sqlite', sqlitePath: db });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ backend: 'sqlite', sqlitePath: db, firstRun: false });
    expect(fs.existsSync(db)).toBe(true);

    // The file location no longer applies.
    const loc = await call('PUT', '/api/setup/location', { location: path.join(work, 'x') });
    expect(loc.status).toBe(409);

    const back = await call('PUT', '/api/setup/storage', { backend: 'file' });
    expect(back.json.data.backend).toBe('file');
  });
});
