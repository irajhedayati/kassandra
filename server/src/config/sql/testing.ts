/**
 * Support for the integration tests (`*.integration.test.ts`): which databases
 * to test against, and an isolated namespace in each for one test to work in.
 *
 * `npm run test:integration` starts the databases and sets
 * KASSANDRA_TEST_POSTGRES_URL / KASSANDRA_TEST_MYSQL_URL; a dialect whose
 * variable is unset is skipped. A namespace is a PostgreSQL schema or a MySQL
 * database, created before the test and dropped after it, so tests neither see
 * each other's data nor need an empty server.
 */
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import pg from 'pg';
import type { SqlDialect } from '@kassandra/shared';
import { parseConnectionUrl, type SqlConnection } from './connection.js';

const URL_VARIABLES: Record<SqlDialect, string> = {
  postgres: 'KASSANDRA_TEST_POSTGRES_URL',
  mysql: 'KASSANDRA_TEST_MYSQL_URL',
};

/** The databases to test against; throws if there are none, so a forgotten setup is not a silent pass. */
export function testTargets(): { dialect: SqlDialect; url: string }[] {
  const targets = (Object.keys(URL_VARIABLES) as SqlDialect[]).flatMap((dialect) => {
    const url = process.env[URL_VARIABLES[dialect]];
    return url ? [{ dialect, url }] : [];
  });
  if (targets.length === 0) {
    throw new Error(
      `${Object.values(URL_VARIABLES).join(' and ')} are not set; run \`npm run test:integration -w @kassandra/server\``,
    );
  }
  return targets;
}

export type ViolationKind = 'unique' | 'check' | 'foreign key';

// PostgreSQL SQLSTATEs, MySQL and MariaDB error names.
const VIOLATION_CODES: Record<ViolationKind, string[]> = {
  unique: ['23505', 'ER_DUP_ENTRY'],
  check: ['23514', 'ER_CHECK_CONSTRAINT_VIOLATED', 'ER_CONSTRAINT_FAILED'],
  'foreign key': ['23503', 'ER_NO_REFERENCED_ROW_2', 'ER_NO_REFERENCED_ROW'],
};

/** True if `err` is the database rejecting a statement for violating a constraint of that kind. */
export function isViolation(err: unknown, kind: ViolationKind): boolean {
  return VIOLATION_CODES[kind].includes((err as { code?: string })?.code ?? '');
}

export interface TestNamespace {
  /** Connection settings pointing at the namespace. */
  connection: SqlConnection;
  /** `table` qualified with the namespace and quoted, for raw SQL. */
  ref(table: string): string;
  /** Run raw SQL as the administrator; use `?` for parameters. */
  query(statement: string, params?: unknown[]): Promise<Record<string, any>[]>;
  drop(): Promise<void>;
}

const admins = new Map<SqlDialect, pg.Pool | mysql.Pool>();

function adminFor(dialect: SqlDialect, url: string): pg.Pool | mysql.Pool {
  let admin = admins.get(dialect);
  if (!admin) {
    admin = dialect === 'postgres' ? new pg.Pool({ connectionString: url, max: 2 }) : mysql.createPool({ uri: url, connectionLimit: 2 });
    admins.set(dialect, admin);
  }
  return admin;
}

/** Close the administrator connections; call once after the last test. */
export async function closeTestAdmins(): Promise<void> {
  await Promise.all([...admins.values()].map((admin) => admin.end()));
  admins.clear();
}

export async function createNamespace(dialect: SqlDialect, url: string): Promise<TestNamespace> {
  const base = parseConnectionUrl(url, dialect);
  const name = `kassandra_test_${crypto.randomBytes(6).toString('hex')}`;
  const admin = adminFor(dialect, url);

  if (dialect === 'postgres') {
    const pool = admin as pg.Pool;
    await pool.query(`CREATE SCHEMA "${name}"`);
    return {
      connection: { ...base, schema: name },
      ref: (table) => `"${name}"."${table}"`,
      query: async (statement, params) => {
        let n = 0;
        return (await pool.query(statement.replace(/\?/g, () => `$${++n}`), params)).rows;
      },
      drop: async () => void (await pool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)),
    };
  }

  const pool = admin as mysql.Pool;
  await pool.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
  return {
    connection: { ...base, database: name },
    ref: (table) => `\`${name}\`.\`${table}\``,
    query: async (statement, params) => (await pool.query(statement, params))[0] as Record<string, any>[],
    drop: async () => void (await pool.query(`DROP DATABASE IF EXISTS \`${name}\``)),
  };
}
