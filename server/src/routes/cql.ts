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
import { toPositional, type QueryResponse, type Row } from '@kassandra/shared';
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
