import { describe, expect, it } from 'vitest';
import { CqlBuildError, buildCreateTableCql, normalizeCqlType } from './create-table.js';
import type { CreateTableRequest } from './types/schema.js';

const base: CreateTableRequest = {
  keyspace: 'shop',
  name: 'orders',
  ifNotExists: false,
  columns: [
    { name: 'customer', type: 'text', kind: 'partition_key' },
    { name: 'placed_at', type: 'timestamp', kind: 'clustering', order: 'DESC' },
    { name: 'total', type: 'decimal', kind: 'regular' },
  ],
};

describe('buildCreateTableCql', () => {
  it('builds keys and clustering order', () => {
    expect(buildCreateTableCql(base)).toBe(
      `CREATE TABLE "shop"."orders" (\n  "customer" text,\n  "placed_at" timestamp,\n  "total" decimal,\n  PRIMARY KEY ("customer", "placed_at")\n)\nWITH CLUSTERING ORDER BY ("placed_at" DESC)`,
    );
  });

  it('builds composite partition keys and options', () => {
    const cql = buildCreateTableCql({
      ...base,
      ifNotExists: true,
      columns: [
        { name: 'a', type: 'int', kind: 'partition_key' },
        { name: 'b', type: 'int', kind: 'partition_key' },
        { name: 'c', type: 'text', kind: 'regular' },
      ],
      comment: "it's",
      defaultTimeToLive: 60,
      gcGraceSeconds: 0,
      compaction: 'LeveledCompactionStrategy',
      compression: 'none',
    });
    expect(cql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(cql).toContain('PRIMARY KEY (("a", "b"))');
    expect(cql).toContain(`comment = 'it''s'`);
    expect(cql).toContain('default_time_to_live = 60');
    expect(cql).toContain('gc_grace_seconds = 0');
    expect(cql).toContain(`compaction = {'class': 'LeveledCompactionStrategy'}`);
    expect(cql).toContain(`compression = {'enabled': false}`);
  });

  it('rejects invalid definitions', () => {
    const bad = (columns: CreateTableRequest['columns']) =>
      expect(() => buildCreateTableCql({ ...base, columns })).toThrow(CqlBuildError);
    bad([{ name: 'a', type: 'text', kind: 'regular' }]);
    bad([
      { name: 'a', type: 'text', kind: 'partition_key' },
      { name: 'A', type: 'text', kind: 'regular' },
    ]);
    bad([{ name: 'a', type: 'list<int>', kind: 'partition_key' }]);
    bad([
      { name: 'a', type: 'int', kind: 'partition_key' },
      { name: 'b', type: 'text', kind: 'static' },
    ]);
    bad([
      { name: 'a', type: 'int', kind: 'partition_key' },
      { name: 'c', type: 'counter', kind: 'regular' },
      { name: 'd', type: 'text', kind: 'regular' },
    ]);
    bad([{ name: 'a"; DROP', type: 'int', kind: 'partition_key' }]);
  });
});

describe('normalizeCqlType', () => {
  it('accepts nested types and rejects unknown ones', () => {
    expect(normalizeCqlType('Frozen<Map<text,List<int>>>')).toBe('frozen<map<text, list<int>>>');
    expect(() => normalizeCqlType('map<text>')).toThrow();
    expect(() => normalizeCqlType('nope')).toThrow();
  });
});
