/**
 * Row-level CRUD using prepared statements.
 * Mirrors legacy/src/database/repository.py, with the SQL-injection bugs
 * (string interpolation in UPDATE/SELECT) fixed via parameter binding.
 *
 *   - INSERT: skip null/empty values; coerce list/set values from arrays.
 *   - UPDATE: SET clause uses regular columns; WHERE uses ALL primary keys.
 *             Parameter-bound (NOT interpolated).
 *   - DELETE: WHERE uses all primary keys, parameter-bound.
 *   - Reads: paging is server-side opaque bytes; expose to the client as
 *            base64 strings via QueryResult.pagingState.
 */
import type { Client as CassandraClient, QueryOptions } from 'cassandra-driver';
import type {
  ColumnInfo,
  CqlValue,
  FilterCondition,
  PaginatedReadRequest,
  QueryResult,
  Row,
  TableSchema,
} from '@kassandra/shared';
import { types as driverTypes } from 'cassandra-driver';
import { mapKeyValueTypes, rootCqlType } from '@kassandra/shared';

export interface CrudResult {
  rowsAffected?: number;
  message?: string;
  /** Primary-key values (driver-typed, ready to bind) of the affected row. */
  keys?: Record<string, unknown>;
}

/** Per-map-column changes for UPDATE: entries to add/overwrite and keys to remove. */
export type MapChanges = Record<string, { set: Record<string, string>; deleted: string[] }>;

/** Quote a CQL identifier (keyspace, table, column) with double quotes. */
function quoteIdent(name: string): string {
  // Defensive: escape any embedded double quotes.
  return `"${name.replace(/"/g, '""')}"`;
}

/** Decode a base64 paging state into the Buffer the driver expects. */
function decodePagingState(s: string | null | undefined): Buffer | undefined {
  if (!s) return undefined;
  return Buffer.from(s, 'base64');
}

/** Encode an opaque paging state buffer to base64 for the client. */
function encodePagingState(state: unknown): string | null {
  if (!state) return null;
  if (Buffer.isBuffer(state)) return state.toString('base64');
  // The driver also exposes pageState as a hex string in some versions.
  if (typeof state === 'string') return Buffer.from(state, 'hex').toString('base64');
  return null;
}

/** Split `base<args>` into its base name and top-level comma-separated args. */
function splitType(cqlType: string): { root: string; args: string[] } {
  const t = cqlType.trim();
  const lt = t.indexOf('<');
  if (lt === -1 || !t.endsWith('>')) return { root: t.toLowerCase(), args: [] };
  const inner = t.slice(lt + 1, -1);
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if (c === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return { root: t.slice(0, lt).trim().toLowerCase(), args };
}

function parseJson(value: unknown, cqlType: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw makeUserError(`Invalid JSON for ${cqlType}`);
  }
}

/**
 * Convert a value (JSON-shaped, or the string the UI form produced) into the
 * JS type the driver expects for `cqlType`. Values that are already of a
 * suitable type pass through untouched.
 */
function coerceByType(cqlType: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const { root, args } = splitType(cqlType);

  try {
    switch (root) {
      case 'frozen':
        return coerceByType(args[0] ?? 'text', value);
      case 'list': {
        const arr = parseJson(value, cqlType);
        if (!Array.isArray(arr)) throw makeUserError(`Expected a JSON array for ${cqlType}`);
        return arr.map((v) => coerceByType(args[0] ?? 'text', v));
      }
      case 'set': {
        const arr = parseJson(value, cqlType);
        if (!Array.isArray(arr)) throw makeUserError(`Expected a JSON array for ${cqlType}`);
        return new Set(arr.map((v) => coerceByType(args[0] ?? 'text', v)));
      }
      case 'map': {
        const obj = parseJson(value, cqlType);
        if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
          throw makeUserError(`Expected a JSON object for ${cqlType}`);
        }
        return new Map(
          Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
            coerceByType(args[0] ?? 'text', k),
            coerceByType(args[1] ?? 'text', v),
          ]),
        );
      }
      case 'tuple': {
        const arr = parseJson(value, cqlType);
        if (!Array.isArray(arr)) throw makeUserError(`Expected a JSON array for ${cqlType}`);
        return new driverTypes.Tuple(...arr.map((v, i) => coerceByType(args[i] ?? 'text', v)));
      }
    }

    if (typeof value !== 'string') return value;
    const s = value.trim();
    switch (root) {
      case 'int':
      case 'smallint':
      case 'tinyint':
      case 'float':
      case 'double': {
        const n = Number(s);
        if (s === '' || Number.isNaN(n)) throw makeUserError(`Invalid ${root} value: ${value}`);
        return n;
      }
      case 'bigint':
      case 'counter':
        return driverTypes.Long.fromString(s);
      case 'varint':
        return driverTypes.Integer.fromString(s);
      case 'decimal':
        return driverTypes.BigDecimal.fromString(s);
      case 'boolean':
        if (s.toLowerCase() === 'true') return true;
        if (s.toLowerCase() === 'false') return false;
        throw makeUserError(`Invalid boolean value: ${value}`);
      case 'uuid':
        return driverTypes.Uuid.fromString(s);
      case 'timeuuid':
        return driverTypes.TimeUuid.fromString(s);
      case 'timestamp': {
        // Values without a zone (datetime-local inputs) are treated as UTC.
        const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`);
        if (Number.isNaN(d.getTime())) throw makeUserError(`Invalid timestamp: ${value}`);
        return d;
      }
      case 'date':
        return driverTypes.LocalDate.fromString(s);
      case 'time':
        return driverTypes.LocalTime.fromString(s);
      case 'duration':
        return driverTypes.Duration.fromString(s);
      case 'inet':
        return driverTypes.InetAddress.fromString(s);
      case 'blob':
        return Buffer.from(s.replace(/^0x/i, ''), 'hex');
      default:
        return value;
    }
  } catch (err) {
    if (err instanceof Error && (err as { status?: number }).status === 400) throw err;
    throw makeUserError(`Invalid ${root} value: ${String(value)}`);
  }
}

/** Coerce a raw JS value before binding to the driver. */
function coerceValue(column: ColumnInfo, value: CqlValue): unknown {
  return coerceByType(column.cql_type, value);
}

/** Build a deep, plain-JS representation of a row that's safe to JSON.stringify. */
function normalizeRow(raw: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = normalizeValue(v);
  }
  return out;
}

function normalizeValue(value: unknown): CqlValue {
  if (value === null || value === undefined) return null;

  // Primitives
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : value.toString();

  // Buffer / blob
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('hex');
  }

  // BigInt
  if (typeof value === 'bigint') return value.toString();

  // Date / timestamp
  if (value instanceof Date) return value.toISOString();

  // Set → array
  if (value instanceof Set) {
    return Array.from(value).map(normalizeValue);
  }

  // Map → plain object
  if (value instanceof Map) {
    const obj: Record<string, CqlValue> = {};
    for (const [k, v] of value) {
      obj[String(k)] = normalizeValue(v);
    }
    return obj;
  }

  // Array
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  // Driver custom types (Uuid, BigDecimal, LocalDate, LocalTime, Long, InetAddress, etc.)
  // all expose a sensible toString().
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    // Plain object literal? Recurse.
    const proto = Object.getPrototypeOf(obj);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, CqlValue> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = normalizeValue(v);
      }
      return out;
    }
    // Custom driver type; fall back to toString().
    if (typeof obj['toString'] === 'function') {
      return obj['toString']();
    }
  }

  return String(value);
}

/** A ColumnInfo with its cql_type swapped out, for coercing map key/value parts. */
function asType(column: ColumnInfo, cqlType: string): ColumnInfo {
  return { ...column, cql_type: cqlType };
}

/**
 * Build the `WHERE` fragment and bound params for a single filter condition.
 * Throws a 400 error for operators that don't apply to the column's type.
 */
function buildFilterClause(
  col: ColumnInfo,
  filter: FilterCondition,
): { sql: string; params: unknown[] } {
  const root = rootCqlType(col.cql_type);
  const ident = quoteIdent(col.name);

  switch (filter.operator) {
    case 'eq':
      return { sql: `${ident} = ?`, params: [coerceValue(col, filter.value)] };

    case 'contains': {
      if (root !== 'map' && root !== 'list' && root !== 'set') {
        throw makeUserError(`CONTAINS is only supported on list/set/map columns: ${col.name}`);
      }
      const kv = mapKeyValueTypes(col.cql_type);
      const valueCol = kv ? asType(col, kv.valueType) : col;
      return { sql: `${ident} CONTAINS ?`, params: [coerceValue(valueCol, filter.value)] };
    }

    case 'contains_key': {
      if (root !== 'map') {
        throw makeUserError(`CONTAINS KEY is only supported on map columns: ${col.name}`);
      }
      const kv = mapKeyValueTypes(col.cql_type);
      const keyCol = kv ? asType(col, kv.keyType) : col;
      return { sql: `${ident} CONTAINS KEY ?`, params: [coerceValue(keyCol, filter.value)] };
    }

    case 'map_entry_eq': {
      if (root !== 'map') {
        throw makeUserError(`Map-entry filters are only supported on map columns: ${col.name}`);
      }
      if (!filter.mapKey || filter.mapKey === '') {
        throw makeUserError(`Map-entry filter on ${col.name} requires a key.`);
      }
      const kv = mapKeyValueTypes(col.cql_type);
      const keyCol = kv ? asType(col, kv.keyType) : asType(col, 'text');
      const valueCol = kv ? asType(col, kv.valueType) : col;
      return {
        sql: `${ident}[?] = ?`,
        params: [coerceValue(keyCol, filter.mapKey), coerceValue(valueCol, filter.value)],
      };
    }
  }
}

export class CassandraRepository {
  constructor(private readonly client: CassandraClient) {}

  /**
   * SELECT * FROM "ks"."t" [WHERE col = ? AND ...]
   *
   * Filters support equality on any column, plus CONTAINS / CONTAINS KEY /
   * map-entry (`map[key] = value`) predicates on collection columns.
   * Cassandra's `ALLOW FILTERING` is appended when filters are present.
   */
  async readRows(
    schema: TableSchema,
    request: PaginatedReadRequest,
  ): Promise<QueryResult> {
    const filters = (request.filters ?? []).filter((f) => f.value !== '' && f.value != null);

    const whereParts: string[] = [];
    const params: unknown[] = [];
    for (const filter of filters) {
      const col = schema.columns.find((c) => c.name === filter.column);
      if (!col) {
        // Bail loudly rather than send a malformed query; the client
        // should only send filter columns that match a real column.
        throw makeUserError(`Unknown filter column: ${filter.column}`);
      }
      const { sql, params: filterParams } = buildFilterClause(col, filter);
      whereParts.push(sql);
      params.push(...filterParams);
    }

    const tableRef = `${quoteIdent(schema.keyspace)}.${quoteIdent(schema.table_name)}`;
    let cql = `SELECT * FROM ${tableRef}`;
    if (whereParts.length > 0) {
      cql += ` WHERE ${whereParts.join(' AND ')} ALLOW FILTERING`;
    }

    const pagingState = decodePagingState(request.pagingState);
    const queryOptions: QueryOptions = {
      prepare: true,
      fetchSize: request.pageSize,
    };
    if (pagingState !== undefined) {
      // The driver accepts a Buffer for `pageState` even though the type
      // declaration is `string`; cast through `unknown` to satisfy the
      // checker without losing the runtime contract.
      (queryOptions as { pageState?: unknown }).pageState = pagingState;
    }
    const result = await this.client.execute(cql, params, queryOptions);

    const rows: Row[] = (result.rows ?? []).map((r) =>
      normalizeRow(r as unknown as Record<string, unknown>),
    );

    const nextState = encodePagingState((result as unknown as { pageState?: unknown }).pageState);

    return {
      success: true,
      rows,
      pagingState: nextState,
      hasMorePages: nextState != null,
    };
  }

  /**
   * INSERT INTO "ks"."t" (col1, col2, ...) VALUES (?, ?, ...)
   *
   * Skip null and empty-string values.
   */
  async insertRow(schema: TableSchema, values: Row): Promise<CrudResult> {
    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: unknown[] = [];

    const keys: Record<string, unknown> = {};

    for (const col of schema.columns) {
      const v = values[col.name];
      const isKey = col.kind === 'partition_key' || col.kind === 'clustering';
      let bound: unknown;
      if (v === null || v === undefined || (typeof v === 'string' && v === '')) {
        // Like the legacy UI: a blank uuid/timeuuid key is generated.
        if (!isKey) continue;
        const root = rootCqlType(col.cql_type);
        if (root === 'uuid') bound = driverTypes.Uuid.random();
        else if (root === 'timeuuid') bound = driverTypes.TimeUuid.now();
        else continue;
      } else {
        bound = coerceValue(col, v);
      }

      columns.push(quoteIdent(col.name));
      placeholders.push('?');
      params.push(bound);
      if (isKey) keys[col.name] = bound;
    }

    if (columns.length === 0) {
      throw makeUserError('No data to insert.');
    }

    const tableRef = `${quoteIdent(schema.keyspace)}.${quoteIdent(schema.table_name)}`;
    const cql = `INSERT INTO ${tableRef} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;

    await this.client.execute(cql, params, { prepare: true });
    return { message: 'Row inserted.', keys };
  }

  /**
   * UPDATE "ks"."t" SET col = ?, ... WHERE pk = ? AND ...
   *
   * `keys` must contain every primary-key column. `updates` should contain
   * the regular columns to set; primary keys in `updates` are ignored.
   */
  async updateRow(
    schema: TableSchema,
    keys: Row,
    updates: Row,
    mapChanges: MapChanges = {},
  ): Promise<CrudResult> {
    const pkSet = new Set(
      schema.columns
        .filter((c) => c.kind === 'partition_key' || c.kind === 'clustering')
        .map((c) => c.name),
    );

    const setParts: string[] = [];
    const setParams: unknown[] = [];
    for (const col of schema.columns) {
      if (pkSet.has(col.name)) continue;
      if (!(col.name in updates)) continue;
      const v = updates[col.name];
      // Allow explicit null (= unset/erase). Skip undefined though.
      if (v === undefined) continue;
      setParts.push(`${quoteIdent(col.name)} = ?`);
      setParams.push(coerceValue(col, v));
    }

    // Map columns: `m = m + ?` merges entries, `m = m - ?` removes keys. One
    // UPDATE can't assign a column twice, so removals get their own statement.
    const removals: { ident: string; keys: Set<unknown> }[] = [];
    for (const [name, change] of Object.entries(mapChanges)) {
      const col = schema.columns.find((c) => c.name === name);
      if (!col || rootCqlType(col.cql_type) !== 'map' || pkSet.has(name)) {
        throw makeUserError(`Not a map column: ${name}`);
      }
      const kv = mapKeyValueTypes(col.cql_type) ?? { keyType: 'text', valueType: 'text' };
      const entries = Object.entries(change.set);
      if (entries.length > 0) {
        setParts.push(`${quoteIdent(name)} = ${quoteIdent(name)} + ?`);
        setParams.push(
          new Map(
            entries.map(([k, v]) => [coerceByType(kv.keyType, k), coerceByType(kv.valueType, v)]),
          ),
        );
      }
      if (change.deleted.length > 0) {
        removals.push({
          ident: quoteIdent(name),
          keys: new Set(change.deleted.map((k) => coerceByType(kv.keyType, k))),
        });
      }
    }

    if (setParts.length === 0 && removals.length === 0) {
      throw makeUserError('No columns to update.');
    }

    const whereParts: string[] = [];
    const whereParams: unknown[] = [];
    const boundKeys: Record<string, unknown> = {};
    for (const col of schema.columns) {
      if (!pkSet.has(col.name)) continue;
      const v = keys[col.name];
      if (v === undefined || v === null) {
        throw makeUserError(`Missing primary key value: ${col.name}`);
      }
      whereParts.push(`${quoteIdent(col.name)} = ?`);
      const bound = coerceValue(col, v);
      whereParams.push(bound);
      boundKeys[col.name] = bound;
    }

    if (whereParts.length === 0) {
      throw makeUserError('Table has no primary key columns.');
    }

    const tableRef = `${quoteIdent(schema.keyspace)}.${quoteIdent(schema.table_name)}`;
    const where = whereParts.join(' AND ');
    const statements: { query: string; params: unknown[] }[] = [];
    if (setParts.length > 0) {
      statements.push({
        query: `UPDATE ${tableRef} SET ${setParts.join(', ')} WHERE ${where}`,
        params: [...setParams, ...whereParams],
      });
    }
    for (const r of removals) {
      statements.push({
        query: `UPDATE ${tableRef} SET ${r.ident} = ${r.ident} - ? WHERE ${where}`,
        params: [r.keys, ...whereParams],
      });
    }

    if (statements.length === 1) {
      await this.client.execute(statements[0]!.query, statements[0]!.params, { prepare: true });
    } else {
      // Same partition, so the batch is atomic and cheap.
      await this.client.batch(statements, { prepare: true });
    }
    return { message: 'Row updated.', keys: boundKeys };
  }

  /** Read one row back by its (already driver-typed) primary-key values. */
  async readRowByKeys(schema: TableSchema, keys: Record<string, unknown>): Promise<Row | null> {
    const names = schema.columns
      .filter((c) => c.kind === 'partition_key' || c.kind === 'clustering')
      .map((c) => c.name);
    const tableRef = `${quoteIdent(schema.keyspace)}.${quoteIdent(schema.table_name)}`;
    const where = names.map((n) => `${quoteIdent(n)} = ?`).join(' AND ');
    const result = await this.client.execute(
      `SELECT * FROM ${tableRef} WHERE ${where}`,
      names.map((n) => keys[n]),
      { prepare: true },
    );
    const row = result.rows?.[0];
    return row ? normalizeRow(row as unknown as Record<string, unknown>) : null;
  }

  /**
   * DELETE FROM "ks"."t" WHERE pk = ? AND ...
   */
  async deleteRow(schema: TableSchema, keys: Row): Promise<CrudResult> {
    const whereParts: string[] = [];
    const whereParams: unknown[] = [];

    for (const col of schema.columns) {
      if (col.kind !== 'partition_key' && col.kind !== 'clustering') continue;
      const v = keys[col.name];
      if (v === undefined || v === null) {
        throw makeUserError(`Missing primary key value: ${col.name}`);
      }
      whereParts.push(`${quoteIdent(col.name)} = ?`);
      whereParams.push(coerceValue(col, v));
    }

    if (whereParts.length === 0) {
      throw makeUserError('Table has no primary key columns.');
    }

    const tableRef = `${quoteIdent(schema.keyspace)}.${quoteIdent(schema.table_name)}`;
    const cql = `DELETE FROM ${tableRef} WHERE ${whereParts.join(' AND ')}`;

    await this.client.execute(cql, whereParams, { prepare: true });
    return { message: 'Row deleted.' };
  }
}

function makeUserError(message: string): Error {
  const err = new Error(message);
  (err as { status?: number }).status = 400;
  return err;
}
