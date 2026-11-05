import { isCqlReservedWord, mapKeyValueTypes, rootCqlType } from '@kassandra/shared';
import type { FilterCondition } from '@kassandra/shared';

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
  kind?: string;
}

/** CQL functions that generate a value server-side; used for empty uuid/timeuuid primary-key columns. */
const UUID_GENERATOR_FN: Record<string, string> = {
  uuid: 'uuid()',
  timeuuid: 'now()',
};

function isPrimaryKeyKind(kind: string | undefined): boolean {
  return kind === 'partition_key' || kind === 'clustering';
}

/**
 * Build `INSERT INTO ks.table (...) VALUES (...);` from raw form values.
 * Empty/unset columns are skipped, except empty uuid/timeuuid primary-key
 * columns, which default to the CQL `uuid()`/`now()` generator functions
 * rather than being omitted (an insert can't leave a key column unset).
 */
export function buildInsertCql(
  keyspace: string,
  tableName: string,
  columns: ColumnLike[],
  values: Record<string, string>,
): string {
  const entries = columns.filter((col) => {
    const v = values[col.name];
    if (v !== undefined && v !== '') return true;
    return isPrimaryKeyKind(col.kind) && UUID_GENERATOR_FN[rootCqlType(unwrapFrozen(col.cql_type))] !== undefined;
  });
  const colList = entries.map((col) => col.name).join(', ');
  const valList = entries
    .map((col) => {
      const v = values[col.name];
      if (v === undefined || v === '') {
        return UUID_GENERATOR_FN[rootCqlType(unwrapFrozen(col.cql_type))];
      }
      return valueToCqlLiteral(v, col.cql_type);
    })
    .join(', ');
  return `INSERT INTO ${keyspace}.${tableName} (${colList})\nVALUES (${valList});`;
}

/** Build `UPDATE ks.table SET ... WHERE ...;` (plus a `DELETE` for removed
 * map entries, if any) from typed key values, raw scalar update strings,
 * and per-map-column key diffs.
 */
export function buildUpdateCql(
  keyspace: string,
  tableName: string,
  columns: ColumnLike[],
  keys: Record<string, unknown>,
  updates: Record<string, unknown>,
  mapDiffs: Record<string, { set: Record<string, string>; deleted: string[] }> = {},
): string {
  const typeOf = (name: string) => columns.find((c) => c.name === name)?.cql_type ?? 'text';
  const whereClause = Object.entries(keys)
    .map(([name, v]) => `${name} = ${valueToCqlLiteral(v, typeOf(name))}`)
    .join(' AND ');

  const setParts = Object.entries(updates).map(
    ([name, v]) => `${name} = ${valueToCqlLiteral(v, typeOf(name))}`,
  );
  const deleteTargets: string[] = [];

  for (const [name, diff] of Object.entries(mapDiffs)) {
    const kv = mapKeyValueTypes(typeOf(name)) ?? { keyType: 'text', valueType: 'text' };
    const setEntries = Object.entries(diff.set);
    if (setEntries.length > 0) {
      const literalEntries = setEntries
        .map(([k, v]) => `${valueToCqlLiteral(k, kv.keyType)}: ${valueToCqlLiteral(v, kv.valueType)}`)
        .join(', ');
      // Merge only the changed/added keys; leaves other entries untouched.
      setParts.push(`${name} = ${name} + {${literalEntries}}`);
    }
    for (const k of diff.deleted) {
      deleteTargets.push(`${name}[${valueToCqlLiteral(k, kv.keyType)}]`);
    }
  }

  const statements: string[] = [];
  if (setParts.length > 0) {
    statements.push(`UPDATE ${keyspace}.${tableName}\nSET ${setParts.join(', ')}\nWHERE ${whereClause};`);
  }
  if (deleteTargets.length > 0) {
    statements.push(`DELETE ${deleteTargets.join(', ')}\nFROM ${keyspace}.${tableName}\nWHERE ${whereClause};`);
  }
  return statements.join('\n\n');
}

/** The identifier as CQL needs it: bare when that is the same name, otherwise double-quoted. */
function cqlIdent(name: string): string {
  return /^[a-z][a-z0-9_]*$/.test(name) && !isCqlReservedWord(name)
    ? name
    : `"${name.replace(/"/g, '""')}"`;
}

/** `text` for `list<text>` / `frozen<set<text>>`; the type itself when it is not a list or set. */
function collectionElementType(cqlType: string): string {
  const inner = unwrapFrozen(cqlType.trim());
  const root = rootCqlType(inner);
  if (root !== 'list' && root !== 'set') return cqlType;
  return inner.slice(inner.indexOf('<') + 1, inner.lastIndexOf('>')).trim();
}

/** A whole-column literal; CQL sets are written with braces, lists with brackets. */
function columnLiteral(value: string, cqlType: string): string {
  const literal = valueToCqlLiteral(value, cqlType);
  if (rootCqlType(unwrapFrozen(cqlType)) === 'set' && literal.startsWith('[') && literal.endsWith(']')) {
    return `{${literal.slice(1, -1)}}`;
  }
  return literal;
}

/**
 * The CQL equivalent of the data grid's filters: the same predicates the
 * server runs, with the values written as literals (the server binds them as
 * parameters), and `ALLOW FILTERING` whenever there is a filter, as the
 * server adds. Filters on columns the table does not have are left out.
 */
export function buildFilterSelectCql(
  keyspace: string,
  tableName: string,
  columns: ColumnLike[],
  filters: FilterCondition[],
): string {
  const table = `${cqlIdent(keyspace)}.${cqlIdent(tableName)}`;
  const predicates: string[] = [];
  for (const filter of filters) {
    const col = columns.find((c) => c.name === filter.column);
    if (!col) continue;
    const ident = cqlIdent(col.name);
    const kv = mapKeyValueTypes(col.cql_type);
    switch (filter.operator) {
      case 'eq':
        predicates.push(`${ident} = ${columnLiteral(filter.value, col.cql_type)}`);
        break;
      case 'contains':
        predicates.push(
          `${ident} CONTAINS ${valueToCqlLiteral(filter.value, kv?.valueType ?? collectionElementType(col.cql_type))}`,
        );
        break;
      case 'contains_key':
        predicates.push(`${ident} CONTAINS KEY ${valueToCqlLiteral(filter.value, kv?.keyType ?? 'text')}`);
        break;
      case 'map_entry_eq':
        predicates.push(
          `${ident}[${valueToCqlLiteral(filter.mapKey ?? '', kv?.keyType ?? 'text')}] = ${valueToCqlLiteral(filter.value, kv?.valueType ?? 'text')}`,
        );
        break;
    }
  }
  if (predicates.length === 0) return `SELECT * FROM ${table};`;
  return `SELECT * FROM ${table}\nWHERE ${predicates.join('\n  AND ')}\nALLOW FILTERING;`;
}
