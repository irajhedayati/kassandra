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
import type { QueryResponse, Row } from '@kassandra/shared';
import { requireSession } from '../cassandra/state.js';

export const cqlRouter = Router();

const ExecSchema = z.object({
  query: z.string(),
  pageSize: z.number().int().positive().optional(),
  pagingState: z.string().nullish(),
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

    type ExecOptions = {
      prepare: boolean;
      fetchSize?: number;
      pageState?: Buffer;
    };
    const options: ExecOptions = { prepare: false };
    if (typeof body.pageSize === 'number') {
      options.fetchSize = body.pageSize;
    }
    if (body.pagingState) {
      options.pageState = Buffer.from(body.pagingState, 'base64');
    }

    try {
      // cassandra-driver's `execute` accepts (query, params, options).
      // We pass an empty params array because the editor takes raw CQL.
      const result = (await ctx.client.execute(body.query, [], options)) as {
        rows?: unknown[];
        pageState?: string | Buffer | null;
        rawPageState?: Buffer | null;
      };

      const rows: Row[] = Array.isArray(result.rows)
        ? result.rows.map((r) => normalizeRow(r))
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
