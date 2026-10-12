/**
 * Saved parametrized queries. A query may reference named parameters
 * (`:userId`); each one is bound as a typed prepared-statement parameter at
 * execution time, never spliced into the CQL text.
 */

/** CQL types a parameter value can be coerced from a string into. */
export const PARAM_TYPES = [
  'text',
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'varint',
  'float',
  'double',
  'decimal',
  'boolean',
  'uuid',
  'timeuuid',
  'timestamp',
  'date',
  'time',
  'inet',
  'blob',
] as const;

export type ParamType = (typeof PARAM_TYPES)[number];

export interface SavedQuery {
  id: string;
  name: string;
  description: string;
  query: string;
  /** Declared type per parameter name; missing names default to 'text'. */
  paramTypes: Record<string, string>;
}

/** Fields the user controls when creating/updating/importing. */
export type SavedQueryInput = Omit<SavedQuery, 'id'>;

export interface ImportSavedQueriesResult {
  created: number;
  updated: number;
  skipped: { name: string; message: string }[];
}

/**
 * Scan CQL and return the `:name` parameter tokens with their positions,
 * ignoring anything inside string literals ('…', $$…$$), quoted identifiers
 * ("…") and comments (--, //, block comments).
 */
export function scanParams(query: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  const n = query.length;
  let i = 0;
  while (i < n) {
    const c = query[i]!;
    const next = query[i + 1];
    if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (query[i] === c) {
          if (query[i + 1] === c) i += 2; // doubled quote escape
          else break;
        } else i++;
      }
      i++;
    } else if (c === '$' && next === '$') {
      const close = query.indexOf('$$', i + 2);
      i = close === -1 ? n : close + 2;
    } else if ((c === '-' && next === '-') || (c === '/' && next === '/')) {
      const nl = query.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
    } else if (c === '/' && next === '*') {
      const close = query.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
    } else if (c === ':' && next !== undefined && /[A-Za-z_]/.test(next)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(query[j]!)) j++;
      out.push({ name: query.slice(i + 1, j), start: i, end: j });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

/** Distinct parameter names in order of first appearance. */
export function extractParamNames(query: string): string[] {
  return [...new Set(scanParams(query).map((p) => p.name))];
}

/**
 * Replace each `:name` with a positional `?` and return the names in bind
 * order (a name used twice appears twice).
 */
export function toPositional(query: string): { cql: string; order: string[] } {
  const found = scanParams(query);
  let cql = '';
  let last = 0;
  for (const p of found) {
    cql += query.slice(last, p.start) + '?';
    last = p.end;
  }
  cql += query.slice(last);
  return { cql, order: found.map((p) => p.name) };
}
