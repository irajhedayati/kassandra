/**
 * How to reach a relational database: the settings, the URL form accepted in
 * KASSANDRA_DB_URL, and the checks both go through.
 */
import { DEFAULT_SQL_SCHEMA, SQL_DEFAULT_PORTS, type SqlDialect } from '@kassandra/shared';

export interface SqlConnection {
  dialect: SqlDialect;
  host: string;
  port: number;
  database: string;
  username: string;
  /** Contains a secret: never log it or send it to the browser. */
  password: string;
  /** Encrypt the connection and verify the server certificate. */
  ssl: boolean;
  /** PostgreSQL schema holding the tables; ignored for MySQL, where the database is the namespace. */
  schema: string;
}

export const DIALECT_LABELS: Record<SqlDialect, string> = { postgres: 'PostgreSQL', mysql: 'MySQL' };

const PROTOCOLS: Record<SqlDialect, string[]> = {
  postgres: ['postgres:', 'postgresql:'],
  mysql: ['mysql:', 'mariadb:'],
};
const EXAMPLE_URLS: Record<SqlDialect, string> = {
  postgres: 'postgres://user:password@host:5432/database',
  mysql: 'mysql://user:password@host:3306/database',
};

/** Letters, digits and underscores only, so a schema name can be used as an identifier safely. */
export const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Throws an Error with a message fit for the user if the connection cannot possibly work. */
export function validateConnection(c: SqlConnection): SqlConnection {
  const label = DIALECT_LABELS[c.dialect];
  if (!c.host.trim()) throw new Error(`Enter the ${label} host`);
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error(`The ${label} port must be between 1 and 65535`);
  if (!c.database.trim()) throw new Error(`Enter the ${label} database name`);
  if (c.dialect === 'postgres' && !SCHEMA_NAME.test(c.schema)) {
    throw new Error(`Invalid PostgreSQL schema name "${c.schema}"; use letters, digits and underscores`);
  }
  return c;
}

/**
 * Parse `postgres://user:password@host:5432/database` (or `mysql://`, `mariadb://`).
 * `?ssl=true` or any `?sslmode=` other than `disable` turns TLS on.
 */
export function parseConnectionUrl(url: string, dialect: SqlDialect): SqlConnection {
  const label = DIALECT_LABELS[dialect];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`The ${label} URL is not valid; expected ${EXAMPLE_URLS[dialect]}`);
  }
  if (!PROTOCOLS[dialect].includes(u.protocol)) {
    throw new Error(`The ${label} URL must start with ${PROTOCOLS[dialect].map((p) => `${p}//`).join(' or ')}`);
  }
  let decoded: { database: string; username: string; password: string };
  try {
    decoded = {
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch {
    throw new Error(`The ${label} URL has an invalid percent-encoding`);
  }
  const sslParam = u.searchParams.get('ssl');
  const sslMode = u.searchParams.get('sslmode');
  return validateConnection({
    dialect,
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port ? Number(u.port) : SQL_DEFAULT_PORTS[dialect],
    ...decoded,
    ssl: sslParam === 'true' || sslParam === '1' || (sslMode !== null && sslMode !== 'disable'),
    schema: DEFAULT_SQL_SCHEMA,
  });
}

/** Where the database is, for messages. Never includes the password. */
export function describeConnection(c: SqlConnection): string {
  const where = `${c.host}:${c.port}/${c.database}`;
  return c.dialect === 'postgres' ? `PostgreSQL database ${where} (schema ${c.schema})` : `MySQL database ${where}`;
}

export function sameConnection(a: SqlConnection, b: SqlConnection): boolean {
  return (
    a.dialect === b.dialect &&
    a.host === b.host &&
    a.port === b.port &&
    a.database === b.database &&
    a.username === b.username &&
    a.password === b.password &&
    a.ssl === b.ssl &&
    // MySQL has no schema; a stale one must not make two identical connections differ.
    (a.dialect === 'mysql' || a.schema === b.schema)
  );
}
