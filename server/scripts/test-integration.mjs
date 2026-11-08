#!/usr/bin/env node
/**
 * Runs the integration tests (src/**\/*.integration.test.ts) against a
 * throwaway PostgreSQL container: starts it on a random local port, waits until
 * it accepts connections, runs vitest with KASSANDRA_TEST_PG_URL set, and removes
 * the container however the run ends.
 *
 * Needs the Docker CLI and a running daemon. To use a database you already have
 * (e.g. a CI service container) set KASSANDRA_TEST_PG_URL yourself and no
 * container is started; KASSANDRA_TEST_PG_IMAGE overrides the image.
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

const IMAGE = process.env.KASSANDRA_TEST_PG_IMAGE ?? 'postgres:17-alpine';
const PASSWORD = 'kassandra';
const READY_TIMEOUT_MS = 60_000;

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf-8' });

let container = null;

function removeContainer() {
  if (!container) return;
  const id = container;
  container = null;
  const result = docker('rm', '--force', '--volumes', id);
  if (result.status !== 0) console.error(`Could not remove container ${id}; remove it with: docker rm -f ${id}\n${result.stderr}`);
}

async function waitUntilReady(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    // The image first runs a temporary server that listens on a unix socket only, so a TCP connection means the real one is up.
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`PostgreSQL did not become ready in ${READY_TIMEOUT_MS / 1000}s: ${err.message}`);
      await sleep(500);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

async function startContainer() {
  const info = docker('info', '--format', '{{.ServerVersion}}');
  if (info.status !== 0) {
    throw new Error(`Cannot reach Docker (is the daemon running?):\n${(info.stderr || info.error?.message || '').trim()}`);
  }
  console.log(`Starting ${IMAGE}...`);
  const run = docker(
    'run', '--detach', '--rm',
    '--label', 'kassandra-integration-test',
    '--env', `POSTGRES_PASSWORD=${PASSWORD}`,
    '--env', 'POSTGRES_DB=kassandra',
    '--publish', '127.0.0.1::5432',
    IMAGE,
  );
  if (run.status !== 0) throw new Error(`docker run failed:\n${run.stderr.trim()}`);
  container = run.stdout.trim();

  const port = docker('port', container, '5432/tcp').stdout.trim().split('\n')[0]?.split(':').pop();
  if (!port) throw new Error(`Could not find the published port of container ${container}`);
  const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/kassandra`;
  await waitUntilReady(url);
  console.log(`PostgreSQL is ready on 127.0.0.1:${port}`);
  return url;
}

function runVitest(url, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--no-install', 'vitest', 'run', '.integration.test.ts', ...extraArgs], {
      stdio: 'inherit',
      env: { ...process.env, KASSANDRA_TEST_PG_URL: url },
    });
    // Ctrl-C reaches vitest too (same process group); wait for it so the container outlives the tests.
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on('error', (err) => {
      console.error(err);
      resolve(1);
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    removeContainer();
    process.exit(130);
  });
}

let exitCode = 1;
try {
  const url = process.env.KASSANDRA_TEST_PG_URL || (await startContainer());
  exitCode = await runVitest(url, process.argv.slice(2));
} catch (err) {
  console.error(err.message);
} finally {
  removeContainer();
}
process.exit(exitCode);
