import { describe, expect, it } from 'vitest';
import { cqlTokenTexts, formatCql } from './cql-format.js';

const samples = [
  "select a,b from ks.t where a=1 and b=2 order by b limit 10;",
  "INSERT INTO t (a,b) VALUES (1,'x;y') IF NOT EXISTS USING TTL 5",
  "update t using ttl 5 set a=1,b = b + 1 where id=:id and k=? if a=2 and b=3;",
  "delete a, b from t where id = 1; delete from t where id = 2",
  "create table if not exists ks.t (id uuid, name text, tags set<text>, primary key ((id), name)) with clustering order by (name desc) and comment='a and b';",
  "select \"from\", 'where' from t -- trailing\nwhere x = 1\n;",
  "begin batch using timestamp 5 insert into t (a) values (1); update t set b=2 where a=1; apply batch;",
  "select * from t;\n\n\n-- note\nselect count(*) from t where a in (1,2,3)",
  "insert into t (a, -- c\n b) values (1,2)",
  "select a from t where b = $$x ' from y$$ and c = 'it''s'",
  "CREATE KEYSPACE ks WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true",
];

describe('formatCql', () => {
  it('breaks a SELECT into clauses', () => {
    expect(formatCql('select a,b from ks.t where a=1 and b=2 order by b limit 10;')).toBe(
      ['select a, b', 'from ks.t', 'where a = 1', '  and b = 2', 'order by b', 'limit 10;'].join('\n'),
    );
  });

  it('formats INSERT, UPDATE and DELETE', () => {
    expect(formatCql("INSERT INTO t (a,b) VALUES (1,'x;y') IF NOT EXISTS USING TTL 5")).toBe(
      ["INSERT INTO t (a, b)", "VALUES (1, 'x;y')", 'IF NOT EXISTS', 'USING TTL 5'].join('\n'),
    );
    expect(formatCql('update t set a=1,b=2 where id=:id and k=? if a=2')).toBe(
      ['update t', 'set a = 1, b = 2', 'where id = :id', '  and k = ?', 'if a = 2'].join('\n'),
    );
    expect(formatCql('delete a, b from t where id = 1')).toBe(['delete a, b', 'from t', 'where id = 1'].join('\n'));
    expect(formatCql('delete from t where id = 1')).toBe(['delete from t', 'where id = 1'].join('\n'));
  });

  it('puts CREATE TABLE columns on their own lines and breaks WITH options', () => {
    expect(
      formatCql("create table if not exists ks.t (id uuid, name text, primary key ((id), name)) with clustering order by (name desc) and comment='x'"),
    ).toBe(
      [
        'create table if not exists ks.t (',
        '  id uuid,',
        '  name text,',
        '  primary key ((id), name)',
        ')',
        'with clustering order by (name desc)',
        "  and comment = 'x'",
      ].join('\n'),
    );
  });

  it('separates statements with a blank line and keeps comments', () => {
    expect(formatCql('select 1 from t;  select 2 from t;\n-- end')).toBe(
      ['select 1', 'from t;', '', 'select 2', 'from t;', '', '-- end'].join('\n'),
    );
    expect(formatCql('select a from t -- why\nwhere a = 1;')).toBe(
      ['select a', 'from t -- why', 'where a = 1;'].join('\n'),
    );
    expect(formatCql('select a, b from t where x=1 -- c1\nand y=2;\n-- tail')).toBe(
      ['select a, b', 'from t', 'where x = 1 -- c1', '  and y = 2;', '', '-- tail'].join('\n'),
    );
  });

  it('keeps a ; that follows a line comment out of the comment', () => {
    const out = formatCql('select a from t -- note\n;');
    expect(out.endsWith('\n;')).toBe(true);
    expect(cqlTokenTexts(out)).toEqual(cqlTokenTexts('select a from t -- note\n;'));
  });

  it('formats a batch with its statements indented', () => {
    expect(formatCql('begin batch insert into t (a) values (1); update t set b=2 where a=1; apply batch;')).toBe(
      [
        'begin batch',
        '  insert into t (a)',
        '  values (1);',
        '  update t',
        '  set b = 2',
        '  where a = 1;',
        'apply batch;',
      ].join('\n'),
    );
  });

  it('wraps a long column list one item per line', () => {
    const cols = Array.from({ length: 12 }, (_, i) => `column_${i}`).join(',');
    const out = formatCql(`insert into some_table (${cols}) values (${cols.replace(/column_/g, '')})`);
    expect(out.split('\n')[0]).toBe('insert into some_table (');
    expect(out).toContain('  column_0,\n  column_1,');
  });

  it('leaves literals, quoted identifiers, parameters and comments exactly as written', () => {
    const q = "select \"From\", 'a   and   b', $$ x  from  y $$ from t where k = :p1 and j = ? -- keep   me";
    const out = formatCql(q);
    for (const piece of ['"From"', "'a   and   b'", '$$ x  from  y $$', ':p1', '-- keep   me']) {
      expect(out).toContain(piece);
    }
  });

  it('does not treat keywords inside strings or quoted identifiers as clauses', () => {
    expect(formatCql("select 'from where' from t")).toBe(["select 'from where'", 'from t'].join('\n'));
    expect(formatCql('select "from" from t')).toBe(['select "from"', 'from t'].join('\n'));
  });

  it('keeps the same tokens and is idempotent for every sample', () => {
    for (const q of samples) {
      const once = formatCql(q);
      expect(cqlTokenTexts(once)).toEqual(cqlTokenTexts(q));
      expect(formatCql(once)).toBe(once);
    }
  });

  it('returns empty or comment-only input unchanged', () => {
    expect(formatCql('')).toBe('');
    expect(formatCql('   \n')).toBe('   \n');
    expect(formatCql('-- nothing\n')).toBe('-- nothing\n');
  });

  it('keeps a trailing newline', () => {
    expect(formatCql('select a from t\n')).toBe('select a\nfrom t\n');
  });

  it('keeps the text of a list that contains comments', () => {
    const out = formatCql('insert into t (a, -- c\n b) values (1,2)');
    expect(out).toContain('(a, -- c\n b)');
    expect(out).toContain('values (1, 2)');
  });
});
