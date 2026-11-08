#!/usr/bin/env node
/**
 * Runs the integration tests (src/**\/*.integration.test.ts) against throwaway
 * database containers: PostgreSQL and MySQL by default. Each container is
 * started on a random local port, waited for until it accepts connections, and
 * removed however the run ends. vitest then runs once with
 * KASSANDRA_TEST_POSTGRES_URL / KASSANDRA_TEST_MYSQL_URL set, and every test
 * runs against each database.
 *
 * Needs the Docker CLI and a running daemon. Options, all environment variables:
 *   KASSANDRA_TEST_DIALECTS         comma separated subset to test, e.g. `postgres`
 *   KASSANDRA_TEST_POSTGRES_URL     use this server instead of starting a container
 *   KASSANDRA_TEST_MYSQL_URL        likewise (e.g. a CI service container)
 *   KASSANDRA_TEST_POSTGRES_IMAGE   default postgres:17-alpine
 *   KASSANDRA_TEST_MYSQL_IMAGE      default mysql:8.4; a mariadb image works too
 * Extra arguments are passed to vitest.
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import mysql from 'mysql2/promise';
import pg from 'pg';

const PASSWORD = 'kassandra';
const READY_TIMEOUT_MS = 120_000;

const DATABASES = {
  postgres: {
    variable: 'KASSANDRA_TEST_POSTGRES_URL',
    image: process.env.KASSANDRA_TEST_POSTGRES_IMAGE ?? 'postgres:17-alpine',
    port: 5432,
    env: { POSTGRES_PASSWORD: PASSWORD, POSTGRES_DB: 'kassandra' },
    url: (port) => `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/kassandra`,
    async ping(url) {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
      try {
        await client.connect();
        await client.query('SELECT 1');
      } finally {
        await client.end().catch(() => {});
      }
    },
  },
  mysql: {
    variable: 'KASSANDRA_TEST_MYSQL_URL',
    image: process.env.KASSANDRA_TEST_MYSQL_IMAGE ?? 'mysql:8.4',
    port: 3306,
    env: { MYSQL_ROOT_PASSWORD: PASSWORD, MYSQL_DATABASE: 'kassandra' },
    url: (port) => `mysql://root:${PASSWORD}@127.0.0.1:${port}/kassandra`,
    async ping(url) {
      const connection = await mysql.createConnection({ uri: url, connectTimeout: 2000 });
      try {
        await connection.query('SELECT 1');
      } finally {
        await connection.end().catch(() => {});
      }
    },
  },
};

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf-8' });
const containers = [];

function removeContainers() {
  for (const id of containers.splice(0)) {
    const result = docker('rm', '--force', '--volumes', id);
    if (result.status !== 0) console.error(`Could not remove container ${id}; remove it with: docker rm -f ${id}\n${result.stderr}`);
  }
}

async function waitUntilReady(name, database, url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    // The images first run a temporary server that does not listen on TCP, so a TCP connection means the real one is up.
    try {
      await database.ping(url);
      return;
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`${name} did not become ready in ${READY_TIMEOUT_MS / 1000}s: ${err.message}`);
      await sleep(500);
    }
  }
}

/** Start a container for `name` and resolve to the URL of its server. */
async function startContainer(name, database) {
  console.log(`Starting ${database.image}...`);
  const run = docker(
    'run', '--detach', '--rm',
    '--label', 'kassandra-integration-test',
    ...Object.entries(database.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    '--publish', `127.0.0.1::${database.port}`,
    database.image,
  );
  if (run.status !== 0) throw new Error(`docker run ${database.image} failed:\n${run.stderr.trim()}`);
  const id = run.stdout.trim();
  containers.push(id);

  const port = docker('port', id, `${database.port}/tcp`).stdout.trim().split('\n')[0]?.split(':').pop();
  if (!port) throw new Error(`Could not find the published port of container ${id} (${name})`);
  const url = database.url(port);
  await waitUntilReady(name, database, url);
  console.log(`${name} is ready on 127.0.0.1:${port}`);
  return url;
}

function runVitest(env, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--no-install', 'vitest', 'run', '.integration.test.ts', ...extraArgs], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    // Ctrl-C reaches vitest too (same process group); wait for it so the containers outlive the tests.
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on('error', (err) => {
      console.error(err);
      resolve(1);
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    removeContainers();
    process.exit(130);
  });
}

let exitCode = 1;
try {
  const names = (process.env.KASSANDRA_TEST_DIALECTS ?? Object.keys(DATABASES).join(','))
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = names.filter((name) => !(name in DATABASES));
  if (unknown.length > 0 || names.length === 0) {
    throw new Error(`KASSANDRA_TEST_DIALECTS must list some of: ${Object.keys(DATABASES).join(', ')} (got "${unknown.join(', ')}")`);
  }

  const needsDocker = names.some((name) => !process.env[DATABASES[name].variable]);
  if (needsDocker) {
    const info = docker('info', '--format', '{{.ServerVersion}}');
    if (info.status !== 0) {
      throw new Error(`Cannot reach Docker (is the daemon running?):\n${(info.stderr || info.error?.message || '').trim()}`);
    }
  }

  // Start all containers together: MySQL needs the longest to initialise.
  const env = {};
  for (const variable of Object.values(DATABASES).map((d) => d.variable)) env[variable] = '';
  await Promise.all(
    names.map(async (name) => {
      const database = DATABASES[name];
      env[database.variable] = process.env[database.variable] || (await startContainer(name, database));
    }),
  );
  exitCode = await runVitest(env, process.argv.slice(2));
} catch (err) {
  console.error(err.message);
} finally {
  removeContainers();
}
process.exit(exitCode);
