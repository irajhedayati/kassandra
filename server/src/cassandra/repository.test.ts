import { describe, expect, it, vi } from 'vitest';
import { types } from 'cassandra-driver';
import type { Client as CassandraClient } from 'cassandra-driver';
import type { TableSchema } from '@kassandra/shared';
import { CassandraRepository } from './repository.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const UUID = types.Uuid.fromString(ID);

function makeSchema(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    keyspace: 'ks',
    table_name: 'people',
    columns: [
      { name: 'id', cql_type: 'uuid', kind: 'partition_key', position: 0 },
      { name: 'name', cql_type: 'text', kind: 'regular', position: 0 },
      { name: 'tags', cql_type: 'set<text>', kind: 'regular', position: 0 },
      { name: 'attrs', cql_type: 'map<text, text>', kind: 'regular', position: 0 },
      { name: 'scores', cql_type: 'map<text, int>', kind: 'regular', position: 0 },
    ],
    ...overrides,
  } as TableSchema;
}

function fakeClient(executeResult: unknown = { rows: [] }): CassandraClient {
  return {
    execute: vi.fn().mockResolvedValue(executeResult),
  } as unknown as CassandraClient;
}

describe('CassandraRepository.insertRow', () => {
  it('skips null/undefined/empty-string values and binds the rest', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.insertRow(schema, { id: ID, name: '', tags: null });

    expect(client.execute).toHaveBeenCalledTimes(1);
    const [cql, params, opts] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('INSERT INTO "ks"."people" ("id") VALUES (?)');
    expect(params).toEqual([UUID]);
    expect(opts).toEqual({ prepare: true });
  });

  it('coerces array values to a Set for `set` columns', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.insertRow(schema, { id: ID, tags: ['a', 'b'] });

    const [, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(params).toEqual([UUID, new Set(['a', 'b'])]);
  });

  it('throws a 400 when there is nothing to insert', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema({
      columns: [{ name: 'id', cql_type: 'text', kind: 'partition_key', position: 0 }],
    } as Partial<TableSchema>);

    await expect(repo.insertRow(schema, { id: null, name: '' })).rejects.toMatchObject({
      message: 'No data to insert.',
      status: 400,
    });
  });
});

describe('CassandraRepository.updateRow', () => {
  it('builds SET from updates and WHERE from all primary keys', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.updateRow(schema, { id: ID }, { name: 'Ada' });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('UPDATE "ks"."people" SET "name" = ? WHERE "id" = ?');
    expect(params).toEqual(['Ada', UUID]);
  });

  it('ignores primary-key columns present in updates', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.updateRow(schema, { id: ID }, { id: 'should-be-ignored', name: 'Ada' });

    const [cql] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('UPDATE "ks"."people" SET "name" = ? WHERE "id" = ?');
  });

  it('throws a 400 when no columns are being updated', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(repo.updateRow(schema, { id: ID }, {})).rejects.toMatchObject({
      message: 'No columns to update.',
      status: 400,
    });
  });

  it('throws a 400 when a primary key value is missing', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(repo.updateRow(schema, {}, { name: 'Ada' })).rejects.toMatchObject({
      message: 'Missing primary key value: id',
      status: 400,
    });
  });
});

describe('typed coercion of form values', () => {
  it('parses string form values by CQL type on insert and returns the keys', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema({
      columns: [
        { name: 'id', cql_type: 'uuid', kind: 'partition_key', position: 0 },
        { name: 'age', cql_type: 'int', kind: 'regular', position: 0 },
        { name: 'born', cql_type: 'timestamp', kind: 'regular', position: 0 },
        { name: 'flag', cql_type: 'boolean', kind: 'regular', position: 0 },
        { name: 'scores', cql_type: 'map<text, int>', kind: 'regular', position: 0 },
      ],
    } as Partial<TableSchema>);

    const out = await repo.insertRow(schema, {
      id: ID,
      age: '42',
      born: '2024-01-02T03:04:05',
      flag: 'true',
      scores: '{"a": "1"}',
    });

    const [, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(params).toEqual([
      UUID,
      42,
      new Date('2024-01-02T03:04:05Z'),
      true,
      new Map([['a', 1]]),
    ]);
    expect(out.keys).toEqual({ id: UUID });
  });

  it('rejects values that do not parse', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema({
      columns: [
        { name: 'id', cql_type: 'uuid', kind: 'partition_key', position: 0 },
        { name: 'age', cql_type: 'int', kind: 'regular', position: 0 },
      ],
    } as Partial<TableSchema>);
    await expect(repo.insertRow(schema, { id: ID, age: 'abc' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('generates a blank uuid partition key', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const out = await repo.insertRow(makeSchema(), { id: '', name: 'Ada' });
    expect(out.keys?.['id']).toBeInstanceOf(types.Uuid);
    const [cql] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('INSERT INTO "ks"."people" ("id", "name") VALUES (?, ?)');
  });
});

describe('CassandraRepository.updateRow map changes', () => {
  it('merges changed entries into one UPDATE', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    await repo.updateRow(makeSchema(), { id: ID }, {}, {
      scores: { set: { a: '1' }, deleted: [] },
    });
    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('UPDATE "ks"."people" SET "scores" = "scores" + ? WHERE "id" = ?');
    expect(params).toEqual([new Map([['a', 1]]), UUID]);
  });

  it('batches additions and removals', async () => {
    const client = { execute: vi.fn(), batch: vi.fn().mockResolvedValue({}) } as unknown as CassandraClient;
    const repo = new CassandraRepository(client);
    await repo.updateRow(makeSchema(), { id: ID }, {}, {
      scores: { set: { a: '1' }, deleted: ['b'] },
    });
    expect(client.execute).not.toHaveBeenCalled();
    const [queries] = (client.batch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(queries).toEqual([
      { query: 'UPDATE "ks"."people" SET "scores" = "scores" + ? WHERE "id" = ?', params: [new Map([['a', 1]]), UUID] },
      { query: 'UPDATE "ks"."people" SET "scores" = "scores" - ? WHERE "id" = ?', params: [new Set(['b']), UUID] },
    ]);
  });
});

describe('CassandraRepository.deleteRow', () => {
  it('builds a WHERE clause from all primary keys', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.deleteRow(schema, { id: ID });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('DELETE FROM "ks"."people" WHERE "id" = ?');
    expect(params).toEqual([UUID]);
  });

  it('throws a 400 when a primary key value is missing', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(repo.deleteRow(schema, {})).rejects.toMatchObject({
      message: 'Missing primary key value: id',
      status: 400,
    });
  });
});

describe('CassandraRepository.readRows', () => {
  it('builds a plain SELECT when there are no filters', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.readRows(schema, { pageSize: 25, pagingState: null, filters: [] });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('SELECT * FROM "ks"."people"');
    expect(params).toEqual([]);
  });

  it('adds a WHERE ... ALLOW FILTERING clause for equality filters', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.readRows(schema, {
      pageSize: 25,
      pagingState: null,
      filters: [{ column: 'name', operator: 'eq', value: 'Ada' }],
    });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('SELECT * FROM "ks"."people" WHERE "name" = ? ALLOW FILTERING');
    expect(params).toEqual(['Ada']);
  });

  it('rejects filters on unknown columns', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(
      repo.readRows(schema, {
        pageSize: 25,
        pagingState: null,
        filters: [{ column: 'bogus', operator: 'eq', value: 'x' }],
      }),
    ).rejects.toMatchObject({
      message: 'Unknown filter column: bogus',
      status: 400,
    });
  });

  it('builds a map[key] = value predicate for map_entry_eq', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.readRows(schema, {
      pageSize: 25,
      pagingState: null,
      filters: [{ column: 'attrs', operator: 'map_entry_eq', mapKey: 'color', value: 'red' }],
    });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('SELECT * FROM "ks"."people" WHERE "attrs"[?] = ? ALLOW FILTERING');
    expect(params).toEqual(['color', 'red']);
  });

  it('rejects a map_entry_eq filter missing a key', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(
      repo.readRows(schema, {
        pageSize: 25,
        pagingState: null,
        filters: [{ column: 'attrs', operator: 'map_entry_eq', value: 'red' }],
      }),
    ).rejects.toMatchObject({
      message: 'Map-entry filter on attrs requires a key.',
      status: 400,
    });
  });

  it('builds a CONTAINS KEY predicate on a map column', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.readRows(schema, {
      pageSize: 25,
      pagingState: null,
      filters: [{ column: 'attrs', operator: 'contains_key', value: 'color' }],
    });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('SELECT * FROM "ks"."people" WHERE "attrs" CONTAINS KEY ? ALLOW FILTERING');
    expect(params).toEqual(['color']);
  });

  it('builds a CONTAINS predicate on a map column value', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.readRows(schema, {
      pageSize: 25,
      pagingState: null,
      filters: [{ column: 'attrs', operator: 'contains', value: 'red' }],
    });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('SELECT * FROM "ks"."people" WHERE "attrs" CONTAINS ? ALLOW FILTERING');
    expect(params).toEqual(['red']);
  });

  it('rejects CONTAINS KEY on a non-map column', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(
      repo.readRows(schema, {
        pageSize: 25,
        pagingState: null,
        filters: [{ column: 'name', operator: 'contains_key', value: 'x' }],
      }),
    ).rejects.toMatchObject({
      message: 'CONTAINS KEY is only supported on map columns: name',
      status: 400,
    });
  });

  it('normalizes rows and base64-encodes the paging state', async () => {
    const client = fakeClient({
      rows: [{ id: ID, name: 'Ada' }],
      pageState: Buffer.from('next-page'),
    });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    const result = await repo.readRows(schema, { pageSize: 25, pagingState: null, filters: [] });

    expect(result.rows).toEqual([{ id: ID, name: 'Ada' }]);
    expect(result.hasMorePages).toBe(true);
    expect(result.pagingState).toBe(Buffer.from('next-page').toString('base64'));
  });

  it('decodes an incoming base64 paging state back into a Buffer for the driver', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();
    const encoded = Buffer.from('resume-here').toString('base64');

    await repo.readRows(schema, { pageSize: 10, pagingState: encoded, filters: [] });

    const [, , opts] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((opts as { pageState?: Buffer }).pageState).toEqual(Buffer.from('resume-here'));
  });
});
