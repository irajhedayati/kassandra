import { describe, expect, it, vi } from 'vitest';
import type { Client as CassandraClient } from 'cassandra-driver';
import type { TableSchema } from '@kassandra/shared';
import { CassandraRepository } from './repository.js';

function makeSchema(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    keyspace: 'ks',
    table_name: 'people',
    columns: [
      { name: 'id', cql_type: 'uuid', kind: 'partition_key', position: 0 },
      { name: 'name', cql_type: 'text', kind: 'regular', position: 0 },
      { name: 'tags', cql_type: 'set<text>', kind: 'regular', position: 0 },
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

    await repo.insertRow(schema, { id: 'abc', name: '', tags: null });

    expect(client.execute).toHaveBeenCalledTimes(1);
    const [cql, params, opts] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('INSERT INTO "ks"."people" ("id") VALUES (?)');
    expect(params).toEqual(['abc']);
    expect(opts).toEqual({ prepare: true });
  });

  it('coerces array values to a Set for `set` columns', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.insertRow(schema, { id: 'abc', tags: ['a', 'b'] });

    const [, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(params).toEqual(['abc', new Set(['a', 'b'])]);
  });

  it('throws a 400 when there is nothing to insert', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

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

    await repo.updateRow(schema, { id: 'abc' }, { name: 'Ada' });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('UPDATE "ks"."people" SET "name" = ? WHERE "id" = ?');
    expect(params).toEqual(['Ada', 'abc']);
  });

  it('ignores primary-key columns present in updates', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.updateRow(schema, { id: 'abc' }, { id: 'should-be-ignored', name: 'Ada' });

    const [cql] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('UPDATE "ks"."people" SET "name" = ? WHERE "id" = ?');
  });

  it('throws a 400 when no columns are being updated', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(repo.updateRow(schema, { id: 'abc' }, {})).rejects.toMatchObject({
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

describe('CassandraRepository.deleteRow', () => {
  it('builds a WHERE clause from all primary keys', async () => {
    const client = fakeClient();
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.deleteRow(schema, { id: 'abc' });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('DELETE FROM "ks"."people" WHERE "id" = ?');
    expect(params).toEqual(['abc']);
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

    await repo.readRows(schema, { pageSize: 25, pagingState: null, filters: {} });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('SELECT * FROM "ks"."people"');
    expect(params).toEqual([]);
  });

  it('adds a WHERE ... ALLOW FILTERING clause for equality filters', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    await repo.readRows(schema, { pageSize: 25, pagingState: null, filters: { name: 'Ada' } });

    const [cql, params] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cql).toBe('SELECT * FROM "ks"."people" WHERE "name" = ? ALLOW FILTERING');
    expect(params).toEqual(['Ada']);
  });

  it('rejects filters on unknown columns', async () => {
    const repo = new CassandraRepository(fakeClient());
    const schema = makeSchema();

    await expect(
      repo.readRows(schema, { pageSize: 25, pagingState: null, filters: { bogus: 'x' } }),
    ).rejects.toMatchObject({
      message: 'Unknown filter column: bogus',
      status: 400,
    });
  });

  it('normalizes rows and base64-encodes the paging state', async () => {
    const client = fakeClient({
      rows: [{ id: 'abc', name: 'Ada' }],
      pageState: Buffer.from('next-page'),
    });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();

    const result = await repo.readRows(schema, { pageSize: 25, pagingState: null, filters: {} });

    expect(result.rows).toEqual([{ id: 'abc', name: 'Ada' }]);
    expect(result.hasMorePages).toBe(true);
    expect(result.pagingState).toBe(Buffer.from('next-page').toString('base64'));
  });

  it('decodes an incoming base64 paging state back into a Buffer for the driver', async () => {
    const client = fakeClient({ rows: [] });
    const repo = new CassandraRepository(client);
    const schema = makeSchema();
    const encoded = Buffer.from('resume-here').toString('base64');

    await repo.readRows(schema, { pageSize: 10, pagingState: encoded, filters: {} });

    const [, , opts] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((opts as { pageState?: Buffer }).pageState).toEqual(Buffer.from('resume-here'));
  });
});
