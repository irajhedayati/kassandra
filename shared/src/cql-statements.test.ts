import { describe, expect, it } from 'vitest';
import { buildDeleteCountQuery, maskCql, splitCqlStatements } from './cql-statements.js';

describe('splitCqlStatements', () => {
  it('splits on semicolons and numbers statements from 1', () => {
    const s = splitCqlStatements("INSERT INTO t (a) VALUES (1);\nupdate t set b = 2 where a = 1;\nSELECT * FROM t;");
    expect(s.map((x) => [x.index, x.command])).toEqual([
      [1, 'INSERT'],
      [2, 'UPDATE'],
      [3, 'SELECT'],
    ]);
    expect(s[0]!.text).toBe('INSERT INTO t (a) VALUES (1)');
  });

  it('does not split inside strings, quoted identifiers or comments', () => {
    const s = splitCqlStatements(
      `INSERT INTO t (a) VALUES ('x;y'); -- trailing; comment\nSELECT "we;ird" FROM t /* a;b */; INSERT INTO t (a) VALUES ($$p;q$$)`,
    );
    expect(s.map((x) => x.command)).toEqual(['INSERT', 'SELECT', 'INSERT']);
  });

  it('drops empty and comment-only segments', () => {
    expect(splitCqlStatements(' ; -- nothing\n;; ')).toEqual([]);
    expect(splitCqlStatements('SELECT 1 FROM t;;')).toHaveLength(1);
  });

  it('keeps a BEGIN BATCH block as one statement', () => {
    const s = splitCqlStatements(
      "BEGIN BATCH INSERT INTO t (a) VALUES (1); INSERT INTO t (a) VALUES (2); APPLY BATCH; SELECT * FROM t",
    );
    expect(s.map((x) => x.command)).toEqual(['BATCH', 'SELECT']);
    expect(s[0]!.text.endsWith('APPLY BATCH')).toBe(true);
  });

  it('returns nothing for blank input', () => {
    expect(splitCqlStatements('  \n ')).toEqual([]);
  });
});

describe('maskCql', () => {
  it('keeps length and hides literal contents', () => {
    const q = "SELECT 'a;b' -- c\nFROM t";
    const m = maskCql(q);
    expect(m).toHaveLength(q.length);
    expect(m).not.toContain(';');
    expect(m).toContain('FROM t');
  });
});

describe('buildDeleteCountQuery', () => {
  it('counts rows for a whole-row delete', () => {
    expect(buildDeleteCountQuery('DELETE FROM ks.t WHERE id = ?')).toEqual({
      cql: 'SELECT COUNT(*) FROM ks.t WHERE id = ?',
      cells: null,
      skipParams: 0,
      takeParams: 1,
    });
  });

  it('reports the cell count for column deletes and skips USING binds', () => {
    const q = buildDeleteCountQuery('DELETE a, b FROM t USING TIMESTAMP ? WHERE id = ? AND ck > ? IF EXISTS');
    expect(q).toMatchObject({
      cql: 'SELECT COUNT(*) FROM t WHERE id = ? AND ck > ?',
      cells: 2,
      skipParams: 1,
      takeParams: 2,
    });
  });

  it('ignores WHERE/IF text inside string literals', () => {
    const q = buildDeleteCountQuery("DELETE FROM t WHERE name = 'if where'");
    expect(q?.cql).toBe("SELECT COUNT(*) FROM t WHERE name = 'if where'");
  });

  it('returns null for non-deletes and deletes without WHERE', () => {
    expect(buildDeleteCountQuery('SELECT * FROM t WHERE a = 1')).toBeNull();
    expect(buildDeleteCountQuery('DELETE FROM t')).toBeNull();
  });
});
