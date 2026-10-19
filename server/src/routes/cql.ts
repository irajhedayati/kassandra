/**
 * Raw CQL execution.
 *
 * Routes (mounted at /api/cql):
 *
 *   POST / → body: CqlExecRequest → QueryResponse
 *
 * Mirrors `legacy/src/database/connection.py:execute_cql`. Empty query
 * yields a success envelope with rows=[] and message='Empty query'.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  buildDeleteCountQuery,
  splitCqlStatements,
  toPositional,
  type QueryResponse,
  type Row,
} from '@kassandra/shared';
import { requireSession } from '../cassandra/state.js';
import { coerceByType } from '../cassandra/repository.js';

export const cqlRouter = Router();

const MAX_ROWS = 100;

const ExecSchema = z.object({
  query: z.string(),
  pageSize: z.number().int().positive().optional(),
  pagingState: z.string().nullish(),
  params: z.record(z.string(), z.object({ type: z.string(), value: z.string() })).optional(),
});

cqlRouter.post('/', async (req, res, next) => {
  try {
    const body = ExecSchema.parse(req.body);
    const ctx = requireSession();

    const trimmed = body.query.trim();
    if (trimmed.length === 0) {
      const empty: QueryResponse = {
        success: true,
        rows: [],
        pagingState: null,
        hasMorePages: false,
        message: 'Empty query',
      };
      res.json(empty);
      return;
    }

    // `:name` parameters are rewritten to positional `?` and bound as typed
    // values via a prepared statement; never concatenated into the CQL.
    const { cql, order } = toPositional(body.query);
    const bound: unknown[] = [];
    for (const name of order) {
      const p = body.params?.[name];
      if (!p) {
        const missing: QueryResponse = { success: false, message: `Missing value for parameter :${name}` };
        res.json(missing);
        return;
      }
      try {
        bound.push(coerceByType(p.type, p.value));
      } catch (coerceErr) {
        const message = coerceErr instanceof Error ? coerceErr.message : String(coerceErr);
        const invalid: QueryResponse = { success: false, message: `Parameter :${name}: ${message}` };
        res.json(invalid);
        return;
      }
    }

    type ExecOptions = {
      prepare: boolean;
      fetchSize?: number;
      pageState?: Buffer;
    };
    const options: ExecOptions = { prepare: order.length > 0 };
    // Always cap the page so a huge result set can't overwhelm the UI.
    options.fetchSize = Math.min(body.pageSize ?? MAX_ROWS, MAX_ROWS);
    if (body.pagingState) {
      options.pageState = Buffer.from(body.pagingState, 'base64');
    }

    const command = splitCqlStatements(cql)[0]?.command;
    // Cassandra doesn't report how many rows a DELETE removed, so count what
    // its WHERE clause matches first. Best effort: a failed count must not
    // stop the delete itself.
    let deleteCount: { count: number; unit: 'row' | 'cell' } | undefined;
    if (command === 'DELETE') {
      deleteCount = await countDeleteTargets(ctx.client, cql, bound);
    }

    try {
      // cassandra-driver's `execute` accepts (query, params, options).
      // Raw CQL carries no bind values unless `:name` parameters were used.
      const result = (await ctx.client.execute(cql, bound, options)) as {
        rows?: unknown[];
        pageState?: string | Buffer | null;
        rawPageState?: Buffer | null;
      };

      const rows: Row[] = Array.isArray(result.rows)
        ? result.rows.slice(0, MAX_ROWS).map((r) => normalizeRow(r))
        : [];

      const rawPageState = result.rawPageState ?? null;
      const pagingStateB64 = rawPageState
        ? Buffer.from(rawPageState).toString('base64')
        : typeof result.pageState === 'string' && result.pageState.length > 0
        ? Buffer.from(result.pageState, 'hex').toString('base64')
        : null;

      const payload: QueryResponse = {
        success: true,
        rows,
        pagingState: pagingStateB64,
        hasMorePages: pagingStateB64 !== null,
      };
      // Lightweight transactions (IF ...) answer with a single [applied] row.
      const applied = rows.length === 1 ? rows[0]?.['[applied]'] : undefined;
      if (typeof applied === 'boolean') payload.applied = applied;
      if (payload.applied !== false) {
        if (command === 'INSERT') payload.affected = { count: 1, unit: 'row' };
        else if (deleteCount) payload.affected = deleteCount;
      }
      res.json(payload);
    } catch (execErr) {
      const message = execErr instanceof Error ? execErr.message : String(execErr);
      const payload: QueryResponse = { success: false, message };
      res.json(payload);
    }
  } catch (err) {
    next(err);
  }
});

async function countDeleteTargets(
  client: { execute: (q: string, p: unknown[], o: { prepare: boolean }) => Promise<{ rows?: unknown[] }> },
  cql: string,
  bound: unknown[],
): Promise<{ count: number; unit: 'row' | 'cell' } | undefined> {
  const plan = buildDeleteCountQuery(cql);
  if (!plan) return undefined;
  try {
    const params = bound.slice(plan.skipParams, plan.skipParams + plan.takeParams);
    const res = await client.execute(plan.cql, params, { prepare: params.length > 0 });
    const raw = (res.rows?.[0] as { count?: { toString(): string } } | undefined)?.count;
    const rowCount = Number(raw?.toString());
    if (!Number.isFinite(rowCount)) return undefined;
    return plan.cells === null
      ? { count: rowCount, unit: 'row' }
      : { count: rowCount * plan.cells, unit: 'cell' };
  } catch {
    return undefined;
  }
}

/**
 * cassandra-driver returns rows as objects keyed by column name. Normalize
 * any non-JSON-serializable values (Buffer, BigInt, Date, Long, etc.) into
 * plain JSON-friendly forms so the wire payload conforms to `Row`.
 */
function normalizeRow(row: unknown): Row {
  if (row === null || typeof row !== 'object') {
    return {};
  }
  const out: Row = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    out[k] = normalizeValue(v);
  }
  return out;
}

function normalizeValue(v: unknown): Row[string] {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString('hex');
  if (Array.isArray(v)) return v.map((x) => normalizeValue(x));
  if (v instanceof Set) return Array.from(v).map((x) => normalizeValue(x));
  if (v instanceof Map) {
    const obj: Record<string, Row[string]> = {};
    for (const [mk, mv] of v.entries()) {
      obj[String(mk)] = normalizeValue(mv);
    }
    return obj;
  }
  if (typeof v === 'object') {
    // Driver-specific types (Long, BigDecimal, InetAddress, LocalDate,
    // LocalTime, TimeUuid, Uuid, Duration) all expose `toString()`.
    const obj = v as { toString?: () => string };
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      return obj.toString();
    }
    const plain: Record<string, Row[string]> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      plain[k] = normalizeValue(val);
    }
    return plain;
  }
  return String(v);
}
