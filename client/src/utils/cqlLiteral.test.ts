import { describe, expect, it } from 'vitest';
import { buildFilterSelectCql, buildInsertCql, buildUpdateCql, valueToCqlLiteral } from './cqlLiteral.js';

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

  it('defaults an empty uuid primary-key column to uuid()', () => {
    const pkColumns = [
      { name: 'id', cql_type: 'uuid', kind: 'partition_key' },
      { name: 'name', cql_type: 'text', kind: 'regular' },
    ];
    const cql = buildInsertCql('ks', 'people', pkColumns, { id: '', name: 'Ada' });
    expect(cql).toContain('INSERT INTO ks.people (id, name)');
    expect(cql).toContain("VALUES (uuid(), 'Ada')");
  });

  it('defaults an empty timeuuid clustering-key column to now()', () => {
    const pkColumns = [
      { name: 'id', cql_type: 'timeuuid', kind: 'clustering' },
      { name: 'name', cql_type: 'text', kind: 'regular' },
    ];
    const cql = buildInsertCql('ks', 'people', pkColumns, { id: '', name: 'Ada' });
    expect(cql).toContain("VALUES (now(), 'Ada')");
  });

  it('omits an empty uuid column that is not part of the primary key', () => {
    const cql = buildInsertCql('ks', 'people', columns, { id: '', name: 'Ada', age: '' });
    expect(cql).toBe("INSERT INTO ks.people (name)\nVALUES ('Ada');");
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

describe('buildFilterSelectCql', () => {
  const columns = [
    { name: 'id', cql_type: 'uuid' },
    { name: 'name', cql_type: 'text' },
    { name: 'age', cql_type: 'int' },
    { name: 'active', cql_type: 'boolean' },
    { name: 'tags', cql_type: 'set<text>' },
    { name: 'scores', cql_type: 'list<int>' },
    { name: 'attrs', cql_type: 'map<text, int>' },
    { name: 'Mixed', cql_type: 'text' },
  ];

  it('selects the whole table when no filter is applied', () => {
    expect(buildFilterSelectCql('ks', 't', columns, [])).toBe('SELECT * FROM ks.t;');
  });

  it('writes equality filters as typed literals with ALLOW FILTERING', () => {
    expect(
      buildFilterSelectCql('ks', 't', columns, [
        { column: 'name', operator: 'eq', value: "o'brien" },
        { column: 'age', operator: 'eq', value: '42' },
        { column: 'active', operator: 'eq', value: 'true' },
        { column: 'id', operator: 'eq', value: '5b6962dd-3f90-4c93-8f61-eabfa4a803e2' },
      ]),
    ).toBe(
      [
        'SELECT * FROM ks.t',
        "WHERE name = 'o''brien'",
        '  AND age = 42',
        '  AND active = true',
        '  AND id = 5b6962dd-3f90-4c93-8f61-eabfa4a803e2',
        'ALLOW FILTERING;',
      ].join('\n'),
    );
  });

  it('handles collection operators with the right element types', () => {
    expect(
      buildFilterSelectCql('ks', 't', columns, [
        { column: 'tags', operator: 'contains', value: 'red' },
        { column: 'scores', operator: 'contains', value: '7' },
        { column: 'attrs', operator: 'contains', value: '3' },
        { column: 'attrs', operator: 'contains_key', value: 'k' },
        { column: 'attrs', operator: 'map_entry_eq', mapKey: 'size', value: '10' },
      ]),
    ).toBe(
      [
        'SELECT * FROM ks.t',
        "WHERE tags CONTAINS 'red'",
        '  AND scores CONTAINS 7',
        '  AND attrs CONTAINS 3',
        "  AND attrs CONTAINS KEY 'k'",
        "  AND attrs['size'] = 10",
        'ALLOW FILTERING;',
      ].join('\n'),
    );
  });

  it('writes whole-collection equality with the right brackets', () => {
    expect(
      buildFilterSelectCql('ks', 't', columns, [
        { column: 'tags', operator: 'eq', value: '["a","b"]' },
        { column: 'scores', operator: 'eq', value: '[1,2]' },
      ]),
    ).toContain("tags = {'a', 'b'}\n  AND scores = [1, 2]");
  });

  it('quotes identifiers only when needed', () => {
    expect(buildFilterSelectCql('My_Ks', 'select', columns, [{ column: 'Mixed', operator: 'eq', value: 'x' }])).toBe(
      ['SELECT * FROM "My_Ks"."select"', "WHERE \"Mixed\" = 'x'", 'ALLOW FILTERING;'].join('\n'),
    );
  });

  it('leaves out filters on columns the table does not have', () => {
    expect(
      buildFilterSelectCql('ks', 't', columns, [
        { column: 'gone', operator: 'eq', value: '1' },
        { column: 'age', operator: 'eq', value: '3' },
      ]),
    ).toBe(['SELECT * FROM ks.t', 'WHERE age = 3', 'ALLOW FILTERING;'].join('\n'));
    expect(buildFilterSelectCql('ks', 't', columns, [{ column: 'gone', operator: 'eq', value: '1' }])).toBe(
      'SELECT * FROM ks.t;',
    );
  });
});
