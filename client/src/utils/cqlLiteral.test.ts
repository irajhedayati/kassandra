import { describe, expect, it } from 'vitest';
import { buildInsertCql, buildUpdateCql, valueToCqlLiteral } from './cqlLiteral.js';

describe('valueToCqlLiteral', () => {
  it('quotes text and escapes embedded quotes', () => {
    expect(valueToCqlLiteral('hello', 'text')).toBe("'hello'");
    expect(valueToCqlLiteral("o'brien", 'text')).toBe("'o''brien'");
  });

  it('renders numbers and booleans unquoted', () => {
    expect(valueToCqlLiteral('42', 'int')).toBe('42');
    expect(valueToCqlLiteral('true', 'boolean')).toBe('true');
    expect(valueToCqlLiteral(false, 'boolean')).toBe('false');
  });

  it('renders null for null/undefined', () => {
    expect(valueToCqlLiteral(null, 'text')).toBe('null');
    expect(valueToCqlLiteral(undefined, 'text')).toBe('null');
  });

  it('renders blob values with a 0x prefix', () => {
    expect(valueToCqlLiteral('deadbeef', 'blob')).toBe('0xdeadbeef');
    expect(valueToCqlLiteral('0xdeadbeef', 'blob')).toBe('0xdeadbeef');
  });

  it('renders list/set values from a JSON-encoded string', () => {
    expect(valueToCqlLiteral('["a","b"]', 'list<text>')).toBe("['a', 'b']");
    expect(valueToCqlLiteral('[1,2,3]', 'set<int>')).toBe('[1, 2, 3]');
  });

  it('renders map values from a JSON-encoded string', () => {
    expect(valueToCqlLiteral('{"a":"1","b":"2"}', 'map<text, text>')).toBe(
      "{'a': '1', 'b': '2'}",
    );
  });

  it('renders tuple values with parentheses', () => {
    expect(valueToCqlLiteral('[1,"a"]', 'tuple<int, text>')).toBe("(1, 'a')");
  });
});

describe('buildInsertCql', () => {
  const columns = [
    { name: 'id', cql_type: 'uuid' },
    { name: 'name', cql_type: 'text' },
    { name: 'age', cql_type: 'int' },
  ];

  it('includes only columns with a non-empty value', () => {
    const cql = buildInsertCql('ks', 'people', columns, {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Ada',
      age: '',
    });
    expect(cql).toContain('INSERT INTO ks.people (id, name)');
    expect(cql).toContain("VALUES (11111111-1111-1111-1111-111111111111, 'Ada')");
    expect(cql).not.toContain('age');
  });
});

describe('buildUpdateCql', () => {
  const columns = [
    { name: 'id', cql_type: 'uuid' },
    { name: 'name', cql_type: 'text' },
    { name: 'tags', cql_type: 'map<text, text>' },
  ];

  it('builds an UPDATE with a WHERE clause from keys', () => {
    const cql = buildUpdateCql(
      'ks',
      'people',
      columns,
      { id: '11111111-1111-1111-1111-111111111111' },
      { name: 'Ada' },
    );
    expect(cql).toContain('UPDATE ks.people');
    expect(cql).toContain("SET name = 'Ada'");
    expect(cql).toContain('WHERE id = 11111111-1111-1111-1111-111111111111');
  });

  it('merges only changed map keys and deletes removed ones', () => {
    const cql = buildUpdateCql(
      'ks',
      'people',
      columns,
      { id: '11111111-1111-1111-1111-111111111111' },
      {},
      { tags: { set: { env: 'prod' }, deleted: ['region'] } },
    );
    expect(cql).toContain("SET tags = tags + {'env': 'prod'}");
    expect(cql).toContain("DELETE tags['region']");
    expect(cql).toContain('FROM ks.people');
  });

  it('returns an empty string when there is nothing to change', () => {
    const cql = buildUpdateCql(
      'ks',
      'people',
      columns,
      { id: '11111111-1111-1111-1111-111111111111' },
      {},
    );
    expect(cql).toBe('');
  });
});
