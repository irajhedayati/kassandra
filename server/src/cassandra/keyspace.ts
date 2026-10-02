/**
 * CREATE KEYSPACE statement builder. DDL cannot use bind markers for
 * identifiers or the replication map, so the inputs are validated strictly and
 * quoted/escaped here.
 *
 * Reference: https://docs.datastax.com/en/cql-oss/3.3/cql/cql_reference/cqlCreateKeyspace.html
 */
import type { CreateKeyspaceRequest } from '@kassandra/shared';

// Cassandra keyspace names: alphanumeric/underscore, start with a letter,
// at most 48 characters.
const KEYSPACE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

function invalid(message: string): Error {
  const err = new Error(message);
  (err as { status?: number }).status = 400;
  return err;
}

function checkReplicas(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalid(`${label} must be a whole number of at least 1`);
  }
  return value;
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function buildCreateKeyspaceCql(req: CreateKeyspaceRequest): string {
  if (!KEYSPACE_NAME.test(req.name)) {
    throw invalid(
      'Keyspace name must start with a letter, contain only letters, digits and underscores, and be at most 48 characters',
    );
  }

  let replication: string;
  if (req.strategy === 'SimpleStrategy') {
    const rf = checkReplicas(req.replicationFactor, 'Replication factor');
    replication = `{'class': 'SimpleStrategy', 'replication_factor': ${rf}}`;
  } else if (req.strategy === 'NetworkTopologyStrategy') {
    const entries = Object.entries(req.datacenters ?? {});
    if (entries.length === 0) throw invalid('Add at least one datacenter');
    const parts = entries.map(([dc, n]) => {
      if (dc.trim() === '') throw invalid('Datacenter name is required');
      return `${quoteString(dc)}: ${checkReplicas(n, `Replicas for "${dc}"`)}`;
    });
    replication = `{'class': 'NetworkTopologyStrategy', ${parts.join(', ')}}`;
  } else {
    throw invalid('Unknown replication strategy');
  }

  return (
    `CREATE KEYSPACE ${req.ifNotExists ? 'IF NOT EXISTS ' : ''}${quoteIdent(req.name)} ` +
    `WITH REPLICATION = ${replication} ` +
    `AND DURABLE_WRITES = ${req.durableWrites ? 'true' : 'false'}`
  );
}
