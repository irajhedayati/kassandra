import { describe, expect, it } from 'vitest';
import { buildCreateKeyspaceCql } from './keyspace.js';

const base = { name: 'shop', durableWrites: true, ifNotExists: false } as const;

describe('buildCreateKeyspaceCql', () => {
  it('builds SimpleStrategy', () => {
    expect(
      buildCreateKeyspaceCql({ ...base, strategy: 'SimpleStrategy', replicationFactor: 3 }),
    ).toBe(
      `CREATE KEYSPACE "shop" WITH REPLICATION = {'class': 'SimpleStrategy', 'replication_factor': 3} AND DURABLE_WRITES = true`,
    );
  });

  it('builds NetworkTopologyStrategy with IF NOT EXISTS and durable_writes off', () => {
    expect(
      buildCreateKeyspaceCql({
        ...base,
        ifNotExists: true,
        durableWrites: false,
        strategy: 'NetworkTopologyStrategy',
        datacenters: { dc1: 3, "d'c2": 2 },
      }),
    ).toBe(
      `CREATE KEYSPACE IF NOT EXISTS "shop" WITH REPLICATION = {'class': 'NetworkTopologyStrategy', 'dc1': 3, 'd''c2': 2} AND DURABLE_WRITES = false`,
    );
  });

  it('rejects bad names and replica counts', () => {
    const ok = { ...base, strategy: 'SimpleStrategy', replicationFactor: 1 } as const;
    expect(() => buildCreateKeyspaceCql({ ...ok, name: 'a"; DROP' })).toThrow();
    expect(() => buildCreateKeyspaceCql({ ...ok, name: '1abc' })).toThrow();
    expect(() => buildCreateKeyspaceCql({ ...ok, replicationFactor: 0 })).toThrow();
    expect(() =>
      buildCreateKeyspaceCql({ ...base, strategy: 'NetworkTopologyStrategy', datacenters: {} }),
    ).toThrow();
  });
});
