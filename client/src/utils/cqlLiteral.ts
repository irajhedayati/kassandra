import { rootCqlType } from '@kassandra/shared';

const NUMERIC_TYPES = new Set([
  'tinyint',
  'smallint',
  'int',
  'bigint',
  'varint',
  'counter',
  'float',
  'double',
  'decimal',
]);

function unwrapFrozen(cqlType: string): string {
  if (cqlType.startsWith('frozen<') && cqlType.endsWith('>')) {
    return cqlType.slice('frozen<'.length, -1);
  }
  return cqlType;
}

function quoteCqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Render an already-parsed JSON value (string/number/boolean/array/object) as a CQL literal. */
function jsonValueToCqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return quoteCqlString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(jsonValueToCqlLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries
      .map(([k, v]) => `${quoteCqlString(k)}: ${jsonValueToCqlLiteral(v)}`)
      .join(', ')}}`;
  }
  return String(value);
}

/**
 * Render a column value (either a raw form string or an already-typed value
 * from a fetched row) as a CQL literal, based on the column's CQL type.
 */
export function valueToCqlLiteral(value: unknown, cqlType: string): string {
  if (value === null || value === undefined) return 'null';
  const root = rootCqlType(unwrapFrozen(cqlType));

  if (root === 'list' || root === 'set' || root === 'tuple') {
    const arr = typeof value === 'string' ? safeJsonParse(value) : value;
    if (Array.isArray(arr)) {
      const items = arr.map(jsonValueToCqlLiteral).join(', ');
      return root === 'tuple' ? `(${items})` : `[${items}]`;
    }
  }

  if (root === 'map') {
    const obj = typeof value === 'string' ? safeJsonParse(value) : value;
    if (obj && typeof obj === 'object') return jsonValueToCqlLiteral(obj);
  }

  if (root === 'boolean') {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value).toLowerCase() === 'true' ? 'true' : 'false';
  }

  if (NUMERIC_TYPES.has(root)) {
    return String(value);
  }

  if (root === 'uuid' || root === 'timeuuid') {
    return String(value);
  }

  if (root === 'blob') {
    const hex = String(value).replace(/^0x/i, '');
    return `0x${hex}`;
  }

  if (root === 'json') {
    const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
    if (parsed !== undefined) return jsonValueToCqlLiteral(parsed);
  }

  // text, varchar, ascii, inet, date, time, timestamp, duration, and any
  // unrecognized type: quoted string literal.
  return quoteCqlString(String(value));
}

interface ColumnLike {
  name: string;
  cql_type: string;
}

/** Build `INSERT INTO ks.table (...) VALUES (...);` from raw form values, skipping empty/unset columns. */
export function buildInsertCql(
  keyspace: string,
  tableName: string,
  columns: ColumnLike[],
  values: Record<string, string>,
): string {
  const entries = columns.filter((col) => {
    const v = values[col.name];
    return v !== undefined && v !== '';
  });
  const colList = entries.map((col) => col.name).join(', ');
  const valList = entries
    .map((col) => valueToCqlLiteral(values[col.name], col.cql_type))
    .join(', ');
  return `INSERT INTO ${keyspace}.${tableName} (${colList})\nVALUES (${valList});`;
}

/** Build `UPDATE ks.table SET ... WHERE ...;` from typed key values and raw update strings. */
export function buildUpdateCql(
  keyspace: string,
  tableName: string,
  columns: ColumnLike[],
  keys: Record<string, unknown>,
  updates: Record<string, unknown>,
): string {
  const typeOf = (name: string) => columns.find((c) => c.name === name)?.cql_type ?? 'text';
  const setClause = Object.entries(updates)
    .map(([name, v]) => `${name} = ${valueToCqlLiteral(v, typeOf(name))}`)
    .join(', ');
  const whereClause = Object.entries(keys)
    .map(([name, v]) => `${name} = ${valueToCqlLiteral(v, typeOf(name))}`)
    .join(' AND ');
  return `UPDATE ${keyspace}.${tableName}\nSET ${setClause}\nWHERE ${whereClause};`;
}
