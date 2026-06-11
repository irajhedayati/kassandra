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
  PaginatedReadRequest,
  QueryResult,
  Row,
  TableSchema,
} from '@py-sandra/shared';
import { rootCqlType } from '@py-sandra/shared';

export interface CrudResult {
  rowsAffected?: number;
  message?: string;
}

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

/** Coerce a raw JS value before binding to the driver. */
function coerceValue(column: ColumnInfo, value: CqlValue): unknown {
  const root = rootCqlType(column.cql_type);
  if (value === null || value === undefined) return null;

  if (root === 'set' && Array.isArray(value)) {
    // The cassandra-driver accepts a Set for `set<...>` columns.
    return new Set(value);
  }
  // list, map, scalars: pass through; the driver handles them.
  return value;
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
    // Custom driver type — fall back to toString().
    if (typeof obj['toString'] === 'function') {
      return obj['toString']();
    }
  }

  return String(value);
}

export class CassandraRepository {
  constructor(private readonly client: CassandraClient) {}

  /**
   * SELECT * FROM "ks"."t" [WHERE col = ? AND ...]
   *
   * Filters apply equality on text columns only (matches legacy behavior).
   * Cassandra's `ALLOW FILTERING` is appended when filters are present.
   */
  async readRows(
    schema: TableSchema,
    request: PaginatedReadRequest,
  ): Promise<QueryResult> {
    const filters = request.filters ?? {};
    const filterEntries = Object.entries(filters).filter(([, v]) => v !== '' && v != null);

    const whereParts: string[] = [];
    const params: unknown[] = [];
    for (const [col, val] of filterEntries) {
      whereParts.push(`${quoteIdent(col)} = ?`);
      params.push(val);
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

    for (const col of schema.columns) {
      const v = values[col.name];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v === '') continue;

      columns.push(quoteIdent(col.name));
      placeholders.push('?');
      params.push(coerceValue(col, v));
    }

    if (columns.length === 0) {
      throw makeUserError('No data to insert.');
    }

    const tableRef = `${quoteIdent(schema.keyspace)}.${quoteIdent(schema.table_name)}`;
    const cql = `INSERT INTO ${tableRef} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;

    await this.client.execute(cql, params, { prepare: true });
    return { message: 'Row inserted.' };
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

    if (setParts.length === 0) {
      throw makeUserError('No columns to update.');
    }

    const whereParts: string[] = [];
    const whereParams: unknown[] = [];
    for (const col of schema.columns) {
      if (!pkSet.has(col.name)) continue;
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
    const cql = `UPDATE ${tableRef} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')}`;

    await this.client.execute(cql, [...setParams, ...whereParams], { prepare: true });
    return { message: 'Row updated.' };
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
