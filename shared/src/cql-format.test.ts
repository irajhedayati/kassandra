import { describe, expect, it } from 'vitest';
import { cqlTokenTexts, formatCql } from './cql-format.js';

const samples = [
  'select a,b from ks.t where a=1 and b=2 order by b limit 10;',
  "INSERT INTO t (a,b) VALUES (1,'x;y') IF NOT EXISTS USING TTL 5",
  'update t using ttl 5 set a=1,b = b + 1 where id=:id and k=? if a=2 and b=3;',
  'delete a, b from t where id = 1; delete from t where id = 2',
  "create table if not exists ks.t (id uuid, name text, tags set<text>, primary key ((id), name)) with clustering order by (name desc) and comment='a and b';",
  'select "from", \'where\' from t -- trailing\nwhere x = 1\n;',
  'begin batch using timestamp 5 insert into t (a) values (1); update t set b=2 where a=1; apply batch;',
  'select * from t;\n\n\n-- note\nselect count(*) from t where a in (1,2,3)',
  'insert into t (a, -- c\n b) values (1,2)',
  "select a from t where b = $$x ' from y$$ and c = 'it''s'",
  "CREATE KEYSPACE ks WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true",
  'select ttl(v), writetime(v), token(k) from t per partition limit 1 allow filtering',
];

/** Same tokens, ignoring the case of words (named parameters excepted). */
function sameTokens(a: string, b: string): boolean {
  const x = cqlTokenTexts(a);
  const y = cqlTokenTexts(b);
  return x.length === y.length && x.every((t, i) => (x[i - 1] === ':' ? t === y[i] : t.toLowerCase() === y[i]!.toLowerCase()));
}

describe('formatCql layout', () => {
  it('breaks a SELECT into clauses', () => {
    expect(formatCql('select a,b from ks.t where a=1 and b=2 order by b limit 10;')).toBe(
      ['SELECT a, b', 'FROM ks.t', 'WHERE a = 1', '  AND b = 2', 'ORDER BY b', 'LIMIT 10;'].join('\n'),
    );
  });

  it('formats INSERT, UPDATE and DELETE', () => {
    expect(formatCql("INSERT INTO t (a,b) VALUES (1,'x;y') IF NOT EXISTS USING TTL 5")).toBe(
      ['INSERT INTO t (a, b)', "VALUES (1, 'x;y')", 'IF NOT EXISTS', 'USING TTL 5'].join('\n'),
    );
    expect(formatCql('update t set a=1,b=2 where id=:id and k=? if a=2')).toBe(
      ['UPDATE t', 'SET a = 1, b = 2', 'WHERE id = :id', '  AND k = ?', 'IF a = 2'].join('\n'),
    );
    expect(formatCql('delete a, b from t where id = 1')).toBe(['DELETE a, b', 'FROM t', 'WHERE id = 1'].join('\n'));
    expect(formatCql('delete from t where id = 1')).toBe(['DELETE FROM t', 'WHERE id = 1'].join('\n'));
  });

  it('puts CREATE TABLE columns on their own lines and breaks WITH options', () => {
    expect(
      formatCql("create table if not exists ks.t (id uuid, name text, primary key ((id), name)) with clustering order by (name desc) and comment='x'"),
    ).toBe(
      [
        'CREATE TABLE IF NOT EXISTS ks.t (',
        '  id uuid,',
        '  name text,',
        '  PRIMARY KEY ((id), name)',
        ')',
        'WITH CLUSTERING ORDER BY (name DESC)',
        "  AND comment = 'x'",
      ].join('\n'),
    );
  });

  it('separates statements with a blank line and keeps comments', () => {
    expect(formatCql('select 1 from t;  select 2 from t;\n-- end')).toBe(
      ['SELECT 1', 'FROM t;', '', 'SELECT 2', 'FROM t;', '', '-- end'].join('\n'),
    );
    expect(formatCql('select a from t -- why\nwhere a = 1;')).toBe(
      ['SELECT a', 'FROM t -- why', 'WHERE a = 1;'].join('\n'),
    );
    expect(formatCql('select a, b from t where x=1 -- c1\nand y=2;\n-- tail')).toBe(
      ['SELECT a, b', 'FROM t', 'WHERE x = 1 -- c1', '  AND y = 2;', '', '-- tail'].join('\n'),
    );
  });

  it('keeps a ; that follows a line comment out of the comment', () => {
    const out = formatCql('select a from t -- note\n;');
    expect(out.endsWith('\n;')).toBe(true);
    expect(sameTokens(out, 'select a from t -- note\n;')).toBe(true);
  });

  it('formats a batch with its statements indented', () => {
    expect(formatCql('begin batch insert into t (a) values (1); update t set b=2 where a=1; apply batch;')).toBe(
      [
        'BEGIN BATCH',
        '  INSERT INTO t (a)',
        '  VALUES (1);',
        '  UPDATE t',
        '  SET b = 2',
        '  WHERE a = 1;',
        'APPLY BATCH;',
      ].join('\n'),
    );
  });

  it('wraps a long column list one item per line', () => {
    const cols = Array.from({ length: 12 }, (_, i) => `column_${i}`).join(',');
    const out = formatCql(`insert into some_table (${cols}) values (${cols.replace(/column_/g, '')})`);
    expect(out.split('\n')[0]).toBe('INSERT INTO some_table (');
    expect(out).toContain('  column_0,\n  column_1,');
  });

  it('returns empty or comment-only input unchanged', () => {
    expect(formatCql('')).toBe('');
    expect(formatCql('   \n')).toBe('   \n');
    expect(formatCql('-- nothing\n')).toBe('-- nothing\n');
  });

  it('keeps a trailing newline', () => {
    expect(formatCql('select a from t\n')).toBe('SELECT a\nFROM t\n');
  });

  it('keeps the text of a list that contains comments', () => {
    const out = formatCql('insert into t (a, -- c\n b) values (1,2)');
    expect(out).toContain('(a, -- c\n b)');
    expect(out).toContain('VALUES (1, 2)');
  });
});

describe('formatCql keyword case', () => {
  it('upper-cases keywords and leaves identifiers, types and function names alone', () => {
    expect(formatCql('create table ks.users (id uuid, name text, created timestamp, primary key (id))')).toBe(
      [
        'CREATE TABLE ks.users (',
        '  id uuid,',
        '  name text,',
        '  created timestamp,',
        '  PRIMARY KEY (id)',
        ')',
      ].join('\n'),
    );
    expect(formatCql('select toTimestamp(now()), Name from Users where id = uuid()')).toBe(
      ['SELECT toTimestamp(now()), Name', 'FROM Users', 'WHERE id = uuid()'].join('\n'),
    );
  });

  it('does not touch literals, quoted identifiers, comments or named parameters', () => {
    const out = formatCql("select \"From\", 'a   and   b', $$ x  from  y $$ from t where k = :where and j = :Select -- and from");
    for (const piece of ['"From"', "'a   and   b'", '$$ x  from  y $$', ':where', ':Select', '-- and from']) {
      expect(out).toContain(piece);
    }
    expect(out).toContain('FROM t');
  });

  it('does not treat keywords inside strings or quoted identifiers as clauses', () => {
    expect(formatCql("select 'from where' from t")).toBe(["SELECT 'from where'", 'FROM t'].join('\n'));
    expect(formatCql('select "from" from t')).toBe(['SELECT "from"', 'FROM t'].join('\n'));
  });

  it('upper-cases words that are keywords only in context', () => {
    expect(formatCql('insert into t (a) values (1) if not exists using ttl 5 and timestamp 7')).toBe(
      ['INSERT INTO t (a)', 'VALUES (1)', 'IF NOT EXISTS', 'USING TTL 5 AND TIMESTAMP 7'].join('\n'),
    );
    expect(formatCql('select a from t per partition limit 2 allow filtering')).toBe(
      ['SELECT a', 'FROM t', 'PER PARTITION LIMIT 2', 'ALLOW FILTERING'].join('\n'),
    );
    expect(formatCql('select count(*), ttl(v), writetime(v) from t')).toBe(
      ['SELECT COUNT(*), TTL(v), WRITETIME(v)', 'FROM t'].join('\n'),
    );
  });

  it('keeps context-only words as they are when they are identifiers', () => {
    expect(formatCql('select key, type, values, count, ttl, timestamp, exists_flag from t where key = 1')).toBe(
      ['SELECT key, type, values, count, ttl, timestamp, exists_flag', 'FROM t', 'WHERE key = 1'].join('\n'),
    );
    expect(formatCql('update t using ttl 5 set ttl = 1, timestamp = 2 where key = 3')).toBe(
      ['UPDATE t', 'USING TTL 5', 'SET ttl = 1, timestamp = 2', 'WHERE key = 3'].join('\n'),
    );
  });

  it('upper-cases keywords in CREATE TYPE and PRIMARY KEY', () => {
    expect(formatCql('create type ks.addr (street text, zip int)')).toBe(
      ['CREATE TYPE ks.addr (', '  street text,', '  zip int', ')'].join('\n'),
    );
  });
});

describe('formatCql safety', () => {
  it('keeps the same tokens (case aside) and is idempotent for every sample', () => {
    for (const q of samples) {
      const once = formatCql(q);
      expect(sameTokens(once, q)).toBe(true);
      expect(formatCql(once)).toBe(once);
    }
  });

  it('never changes the case of a named parameter', () => {
    for (const q of ['select a from t where k = :Key and j = :values', 'insert into t (a) values (:Set)']) {
      const params = (s: string) => s.match(/:\w+/g);
      expect(params(formatCql(q))).toEqual(params(q));
    }
  });
});
