/**
 * Layout-only CQL formatter for the raw CQL editor.
 *
 * It only changes whitespace between tokens: clause keywords start new lines,
 * continuation lines are indented, long or CREATE TABLE column lists are put
 * one item per line, runs of whitespace collapse, commas and comparison
 * operators get consistent spacing. Identifier and keyword case, literals,
 * comments, parameters and statement order are never touched. As a safety net
 * the result is re-tokenised and must give exactly the original tokens;
 * otherwise formatCql throws and the caller keeps the original text.
 */

interface Tok {
  kind: 'word' | 'literal' | 'comment' | 'punct';
  text: string;
  start: number;
  end: number;
  /** Whitespace that preceded the token. */
  gap: string;
}

const WORD_CHAR = /[A-Za-z0-9_]/;
const TWO_CHAR_OPS = new Set(['<=', '>=', '!=', '+=', '-=']);
const SPACED_OPS = new Set(['=', ...TWO_CHAR_OPS]);
const MAX_LINE = 80;

export class CqlFormatError extends Error {}

function tokenize(cql: string): Tok[] {
  const toks: Tok[] = [];
  const n = cql.length;
  let i = 0;
  while (i < n) {
    const gapStart = i;
    while (i < n && /\s/.test(cql[i]!)) i++;
    const gap = cql.slice(gapStart, i);
    if (i >= n) break;
    const start = i;
    const c = cql[i]!;
    const next = cql[i + 1];
    let kind: Tok['kind'];
    if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (cql[i] === c) {
          if (cql[i + 1] === c) i += 2; // doubled quote escape
          else {
            i++;
            break;
          }
        } else i++;
      }
      kind = 'literal';
    } else if (c === '$' && next === '$') {
      const close = cql.indexOf('$$', i + 2);
      i = close === -1 ? n : close + 2;
      kind = 'literal';
    } else if ((c === '-' && next === '-') || (c === '/' && next === '/')) {
      const nl = cql.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      kind = 'comment';
    } else if (c === '/' && next === '*') {
      const close = cql.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      kind = 'comment';
    } else if (WORD_CHAR.test(c)) {
      while (i < n && WORD_CHAR.test(cql[i]!)) i++;
      kind = 'word';
    } else {
      i += next !== undefined && TWO_CHAR_OPS.has(c + next) ? 2 : 1;
      kind = 'punct';
    }
    const text = cql.slice(start, i).trimEnd();
    toks.push({ kind, text, start, end: start + text.length, gap });
  }
  return toks;
}

/** Token texts of `cql`, whitespace excluded. Two queries with equal lists differ only in layout. */
export function cqlTokenTexts(cql: string): string[] {
  return tokenize(cql).map((t) => t.text);
}

const isLineComment = (t: Tok) => t.kind === 'comment' && !t.text.startsWith('/*');
const upper = (t: Tok | undefined) => (t?.kind === 'word' ? t.text.toUpperCase() : '');

/** Whitespace to put between `prev` and `t` on the same line. */
function sep(prev: Tok, t: Tok): string {
  if (t.text === ',' || t.text === ';' || t.text === ')') return '';
  if (prev.text === '(') return '';
  if (prev.text === ',') return ' ';
  if (SPACED_OPS.has(t.text) || SPACED_OPS.has(prev.text)) return ' ';
  return t.gap === '' ? '' : ' ';
}

function renderInline(tokens: Tok[]): string {
  let out = '';
  let prev: Tok | null = null;
  for (const t of tokens) {
    if (prev) out += sep(prev, t);
    out += t.text;
    prev = t;
  }
  return out;
}

const OPENERS = new Set(['(', '{', '[']);
const CLOSERS = new Set([')', '}', ']']);

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchingParen(toks: Tok[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.kind !== 'punct') continue;
    if (OPENERS.has(t.text)) depth++;
    else if (CLOSERS.has(t.text) && --depth === 0) return t.text === ')' ? i : -1;
  }
  return -1;
}

/** Split `tokens` at commas that are not nested in brackets. */
function splitTopLevel(tokens: Tok[]): Tok[][] {
  const items: Tok[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'punct') {
      if (OPENERS.has(t.text)) depth++;
      else if (CLOSERS.has(t.text)) depth = Math.max(0, depth - 1);
      else if (t.text === ',' && depth === 0) {
        items.push([]);
        continue;
      }
    }
    items[items.length - 1]!.push(t);
  }
  return items;
}

/** Clause keywords that start a new line, per statement type (first occurrence only). */
const CLAUSES: Record<string, string[][]> = {
  SELECT: [['FROM'], ['WHERE'], ['GROUP', 'BY'], ['ORDER', 'BY'], ['PER', 'PARTITION', 'LIMIT'], ['LIMIT'], ['ALLOW', 'FILTERING']],
  INSERT: [['VALUES'], ['IF'], ['USING']],
  UPDATE: [['USING'], ['SET'], ['WHERE'], ['IF']],
  DELETE: [['FROM'], ['USING'], ['WHERE'], ['IF']],
};
const OTHER_CLAUSES = [['WITH']];
/** Inside these clauses AND starts an indented line. */
const AND_CLAUSES = new Set(['WHERE', 'IF', 'WITH']);

function clauseAt(toks: Tok[], i: number, rules: string[][]): string[] | undefined {
  return rules.find((r) => r.every((w, k) => upper(toks[i + k]) === w));
}

/** Format the tokens of one statement (no trailing `;`) into lines. */
function formatStatement(toks: Tok[], source: string): string[] {
  const firstWord = upper(toks.find((t) => t.kind === 'word'));
  const secondWord = upper(toks.filter((t) => t.kind === 'word')[1]);
  const rules = CLAUSES[firstWord] ?? OTHER_CLAUSES;

  const lines: string[] = [];
  let cur = '';
  let curIndent = 0;
  let prev: Tok | null = null;
  let prevWord = '';
  let started = false;
  let clause = '';
  let depth = 0;
  const seen = new Set<string>();

  const flush = () => {
    if (cur.trim() !== '') lines.push(' '.repeat(curIndent) + cur);
    cur = '';
  };
  const newline = (indent: number) => {
    flush();
    curIndent = indent;
  };
  const add = (t: Tok, text = t.text) => {
    cur += (cur === '' || !prev ? '' : sep(prev, t)) + text;
    prev = t;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;

    if (t.kind === 'comment') {
      const ownLine = !started || t.gap.includes('\n');
      if (ownLine) newline(0);
      add(t);
      if (ownLine || isLineComment(t)) newline(started ? 2 : 0);
      continue;
    }

    if (depth === 0 && t.kind === 'word') {
      const up = t.text.toUpperCase();
      const rule = started ? clauseAt(toks, i, rules) : undefined;
      const key = rule?.join(' ');
      if (rule && key && !seen.has(key) && !(up === 'FROM' && prevWord === 'DELETE')) {
        seen.add(key);
        clause = rule[0]!;
        newline(0);
      } else if (up === 'AND' && AND_CLAUSES.has(clause)) {
        newline(2);
      }
    }

    if (depth === 0 && t.text === '(') {
      const end = matchingParen(toks, i);
      if (end !== -1) {
        const group = toks.slice(i, end + 1);
        if (group.some((g) => g.kind === 'comment')) {
          // Comments inside the list: keep its text exactly as written.
          add(group[0]!, source.slice(group[0]!.start, group[group.length - 1]!.end));
          prev = group[group.length - 1]!;
        } else {
          const inner = group.slice(1, -1);
          const inline = renderInline(group);
          const alwaysExpand =
            firstWord === 'CREATE' && clause === '' && /^(TABLE|TYPE|COLUMNFAMILY)$/.test(secondWord);
          const tooLong = curIndent + cur.length + (cur === '' ? 0 : 1) + inline.length > MAX_LINE;
          const items = splitTopLevel(inner).filter((it) => it.length > 0);
          if ((alwaysExpand || tooLong) && items.length > 1) {
            const base = curIndent;
            add(group[0]!);
            newline(base + 2);
            items.forEach((item, k) => {
              cur = renderInline(item) + (k < items.length - 1 ? ',' : '');
              if (k < items.length - 1) newline(base + 2);
            });
            newline(base);
            prev = null;
            add(group[group.length - 1]!);
          } else {
            group.forEach((g) => add(g));
          }
        }
        started = true;
        prevWord = ')';
        i = end;
        continue;
      }
    }

    add(t);
    started = true;
    prevWord = upper(t) || t.text;
    if (t.kind === 'punct') {
      if (OPENERS.has(t.text)) depth++;
      else if (CLOSERS.has(t.text)) depth = Math.max(0, depth - 1);
      else if (t.text === ',' && depth === 0 && curIndent + cur.length > MAX_LINE && i < toks.length - 1) {
        newline(2);
      }
    }
  }
  flush();
  return lines;
}

/** Add the `;` that ended a statement; after a `--` comment it needs a line of its own. */
function terminate(lines: string[], toks: Tok[], terminated: boolean): string[] {
  if (!terminated) return lines;
  const last = toks[toks.length - 1];
  if (lines.length === 0 || (last && isLineComment(last))) return [...lines, ';'];
  return [...lines.slice(0, -1), lines[lines.length - 1] + ';'];
}

interface Segment {
  toks: Tok[];
  terminated: boolean;
}

/** Split on top-level `;`; a BEGIN ... BATCH block up to APPLY BATCH is one segment. */
function splitSegments(toks: Tok[]): Segment[] {
  const segments: Segment[] = [];
  let cur: Tok[] = [];
  let inBatch = false;
  let closing = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const up = upper(t);
    if (!inBatch && up === 'BEGIN') {
      let j = i + 1;
      if (upper(toks[j]) === 'UNLOGGED' || upper(toks[j]) === 'COUNTER') j++;
      if (upper(toks[j]) === 'BATCH') inBatch = true;
    } else if (inBatch && up === 'APPLY' && upper(toks[i + 1]) === 'BATCH') {
      closing = true;
    }
    if (t.text === ';' && t.kind === 'punct' && (!inBatch || closing)) {
      segments.push({ toks: cur, terminated: true });
      cur = [];
      inBatch = false;
      closing = false;
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) segments.push({ toks: cur, terminated: false });
  return segments;
}

const STATEMENT_START = new Set(['INSERT', 'UPDATE', 'DELETE']);

function formatBatch(toks: Tok[], source: string): string[] | null {
  const begin = toks.findIndex((t) => upper(t) === 'BEGIN');
  const lastApply = toks.map((t, i) => (upper(t) === 'APPLY' && upper(toks[i + 1]) === 'BATCH' ? i : -1)).filter((i) => i >= 0).pop();
  const firstStatement = toks.findIndex((t, i) => i > begin && STATEMENT_START.has(upper(t)));
  if (begin === -1 || lastApply === undefined || firstStatement === -1 || firstStatement > lastApply) return null;

  const leading = toks.slice(0, begin);
  const header = toks.slice(begin, firstStatement);
  const inner = toks.slice(firstStatement, lastApply);
  const footer = toks.slice(lastApply);
  if (header.some((t) => t.kind === 'comment') || footer.some((t) => t.kind === 'comment' && isLineComment(t) && t !== footer[footer.length - 1])) return null;

  const lines = [...formatStatement(leading, source), renderInline(header)];
  for (const seg of splitSegments(inner)) {
    const body = terminate(formatStatement(seg.toks, source), seg.toks, seg.terminated);
    lines.push(...body.map((l) => `  ${l}`));
  }
  lines.push(renderInline(footer));
  return lines;
}

/**
 * Reformat `cql` (one or several `;`-separated statements) for readability.
 * Throws CqlFormatError if the result would not contain exactly the same
 * tokens, in which case the original should be kept.
 */
export function formatCql(cql: string): string {
  const toks = tokenize(cql);
  if (!toks.some((t) => t.kind !== 'comment')) return cql;

  const blocks: string[] = [];
  for (const seg of splitSegments(toks)) {
    const isBatch = upper(seg.toks.find((t) => t.kind !== 'comment')) === 'BEGIN';
    const lines = (isBatch ? formatBatch(seg.toks, cql) : null) ?? formatStatement(seg.toks, cql);
    blocks.push(terminate(lines, seg.toks, seg.terminated).join('\n'));
  }
  const result = blocks.join('\n\n') + (/\n\s*$/.test(cql) ? '\n' : '');

  const before = tokenize(cql).map((t) => t.text);
  const after = tokenize(result).map((t) => t.text);
  if (before.length !== after.length || before.some((t, i) => t !== after[i])) {
    throw new CqlFormatError('Could not format this query safely; it was left unchanged.');
  }
  return result;
}
