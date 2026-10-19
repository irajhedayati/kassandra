/**
 * Helpers for running several `;`-separated CQL statements one by one from
 * the raw CQL editor.
 */

export interface CqlStatement {
  /** 1-based position among the statements in the editor. */
  index: number;
  /** Statement text without the trailing `;`. */
  text: string;
  /** Upper-cased leading keyword (SELECT, INSERT, UPDATE, DELETE, ...); BEGIN ... BATCH reports BATCH. */
  command: string;
}

/**
 * Return `cql` with the same length, but comments blanked out and the insides
 * of string literals ('…', $$…$$) and quoted identifiers ("…") replaced with
 * `x`. Keyword/punctuation searches on the result can't match inside them,
 * and indexes line up with the original text.
 */
export function maskCql(cql: string): string {
  const n = cql.length;
  const out = cql.split('');
  const fill = (from: number, to: number, ch: string) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ch;
  };
  let i = 0;
  while (i < n) {
    const c = cql[i]!;
    const next = cql[i + 1];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (cql[j] === c) {
          if (cql[j + 1] === c) j += 2; // doubled quote escape
          else break;
        } else j++;
      }
      fill(i + 1, j, 'x');
      i = j + 1;
    } else if (c === '$' && next === '$') {
      const close = cql.indexOf('$$', i + 2);
      const end = close === -1 ? n : close;
      fill(i + 2, end, 'x');
      i = close === -1 ? n : close + 2;
    } else if ((c === '-' && next === '-') || (c === '/' && next === '/')) {
      const nl = cql.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      fill(i, end, ' ');
      i = end;
    } else if (c === '/' && next === '*') {
      const close = cql.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      fill(i, end, ' ');
      i = end;
    } else {
      i++;
    }
  }
  return out.join('');
}

const BEGIN_BATCH = /^\s*begin\s+(?:unlogged\s+|counter\s+)?batch\b/i;
const ENDS_WITH_APPLY_BATCH = /\bapply\s+batch\s*$/i;

/**
 * Split editor content on top-level `;` into statements. Semicolons inside
 * string literals, quoted identifiers and comments don't split, and a
 * `BEGIN BATCH ... APPLY BATCH` block stays one statement. Segments that are
 * empty or comment-only are dropped.
 */
export function splitCqlStatements(cql: string): CqlStatement[] {
  const masked = maskCql(cql);
  const out: CqlStatement[] = [];
  let start = 0;
  const push = (end: number) => {
    const maskedPart = masked.slice(start, end);
    if (maskedPart.trim() === '') return;
    const first = /[A-Za-z]+/.exec(maskedPart)?.[0].toUpperCase() ?? '';
    out.push({
      index: out.length + 1,
      text: cql.slice(start, end).trim(),
      command: first === 'BEGIN' ? 'BATCH' : first,
    });
  };
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== ';') continue;
    const part = masked.slice(start, i);
    if (BEGIN_BATCH.test(part) && !ENDS_WITH_APPLY_BATCH.test(part.trim())) continue;
    push(i);
    start = i + 1;
  }
  push(masked.length);
  return out;
}

export interface DeleteCountQuery {
  /** `SELECT COUNT(*)` over the rows the DELETE's WHERE clause matches. */
  cql: string;
  /** Number of columns named in `DELETE col1, col2 FROM`; null when whole rows are deleted. */
  cells: number | null;
  /** Of the DELETE's positional `?` binds, skip this many... */
  skipParams: number;
  /** ...then take this many for the count query (the WHERE clause's). */
  takeParams: number;
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Build the query that counts what a positional-`?` DELETE would remove.
 * Returns null when the statement isn't a DELETE with a WHERE clause.
 */
export function buildDeleteCountQuery(cql: string): DeleteCountQuery | null {
  const masked = maskCql(cql);
  const head = /^\s*delete\b([\s\S]*?)\bfrom\s+([\w."]+)/i.exec(masked);
  if (!head) return null;
  const afterTable = head[0].length;
  const where = /\bwhere\b/i.exec(masked.slice(afterTable));
  if (!where) return null;
  const whereStart = afterTable + where.index + where[0].length;
  const ifMatch = /\bif\b/i.exec(masked.slice(whereStart));
  const whereEnd = ifMatch ? whereStart + ifMatch.index : masked.length;

  const tableStart = head[0].length - head[2]!.length;
  const table = cql.slice(tableStart, head[0].length);
  const whereText = cql.slice(whereStart, whereEnd).trim().replace(/;\s*$/, '');
  const columnsMasked = head[1]!.trim();
  // Literals are masked, so commas inside `m['a,b']` don't inflate the count.
  const cells =
    columnsMasked === ''
      ? null
      : columnsMasked.split(',').filter((part) => part.trim() !== '').length;

  return {
    cql: `SELECT COUNT(*) FROM ${table} WHERE ${whereText}`,
    cells,
    skipParams: countChar(masked.slice(0, whereStart), '?'),
    takeParams: countChar(masked.slice(whereStart, whereEnd), '?'),
  };
}
