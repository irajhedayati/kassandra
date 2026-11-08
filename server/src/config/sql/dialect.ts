/**
 * What differs between the supported databases, kept out of the repository: how
 * the connection pool is built, how a failed insert of an existing key shows up,
 * and how text is ordered.
 */
import { Kysely, MysqlDialect, PostgresDialect, sql, type RawBuilder } from 'kysely';
import { createPool } from 'mysql2';
import pg from 'pg';
import type { SqlConnection } from './connection.js';
import type { Database } from './schema.js';

const CONNECT_TIMEOUT_MS = 10_000;

export function createDatabase(c: SqlConnection): Kysely<Database> {
  if (c.dialect === 'postgres') {
    const pool = new pg.Pool({
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.username,
      password: c.password,
      ssl: c.ssl || undefined,
      // The tables live in one schema; every pooled connection resolves unqualified names there.
      options: `-c search_path=${c.schema}`,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });
    // An idle client dropped by the server must not crash the process; the pool replaces it.
    pool.on('error', (err) => console.warn(`[kassandra] PostgreSQL connection error: ${err.message}`));
    return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  }
  const pool = createPool({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.username,
    password: c.password,
    ssl: c.ssl ? { rejectUnauthorized: true } : undefined,
    charset: 'utf8mb4',
    connectionLimit: 10,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  return new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
}

/** True if `err` is the database refusing a row because its primary or unique key already exists. */
export function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown };
  return e?.code === '23505' || e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}

/**
 * Byte-wise ordering of a text column, so lists sort the same whatever the
 * database collation. MySQL columns are created with a binary collation already.
 */
export function byText(c: SqlConnection, column: string): RawBuilder<unknown> {
  return c.dialect === 'postgres' ? sql`${sql.ref(column)} collate "C"` : sql`${sql.ref(column)}`;
}
