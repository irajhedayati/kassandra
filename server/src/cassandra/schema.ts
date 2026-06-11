/**
 * Schema introspection — queries system_schema.keyspaces / .tables / .columns.
 * Mirrors legacy/src/database/model.py SchemaInspector (lines 250–376).
 *
 * System keyspaces filtered out:
 *   system, system_auth, system_schema, system_distributed,
 *   system_traces, system_views, system_virtual_schema
 */
import type { Client as CassandraClient } from 'cassandra-driver';
import type {
  ColumnInfo,
  ColumnKind,
  ClusteringOrder,
  TableSchema,
} from '@py-sandra/shared';

const SYSTEM_KEYSPACES = new Set<string>([
  'system',
  'system_auth',
  'system_schema',
  'system_distributed',
  'system_traces',
  'system_views',
  'system_virtual_schema',
]);

const KIND_VALUES: ReadonlySet<ColumnKind> = new Set<ColumnKind>([
  'partition_key',
  'clustering',
  'regular',
  'static',
]);

function normalizeKind(raw: unknown): ColumnKind {
  if (typeof raw === 'string' && KIND_VALUES.has(raw as ColumnKind)) {
    return raw as ColumnKind;
  }
  return 'regular';
}

function normalizeClusteringOrder(raw: unknown): ClusteringOrder {
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase();
    if (upper === 'DESC') return 'DESC';
  }
  return 'ASC';
}

export async function getKeyspaces(client: CassandraClient): Promise<string[]> {
  const result = await client.execute(
    'SELECT keyspace_name FROM system_schema.keyspaces',
    [],
    { prepare: true },
  );
  const names: string[] = [];
  for (const row of result.rows) {
    const name = row['keyspace_name'];
    if (typeof name === 'string' && !SYSTEM_KEYSPACES.has(name)) {
      names.push(name);
    }
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

export async function getTables(
  client: CassandraClient,
  keyspace: string,
): Promise<string[]> {
  const result = await client.execute(
    'SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?',
    [keyspace],
    { prepare: true },
  );
  const names: string[] = [];
  for (const row of result.rows) {
    const name = row['table_name'];
    if (typeof name === 'string') {
      names.push(name);
    }
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

export async function getTableSchema(
  client: CassandraClient,
  keyspace: string,
  table: string,
): Promise<TableSchema> {
  const result = await client.execute(
    'SELECT column_name, type, kind, position, clustering_order FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?',
    [keyspace, table],
    { prepare: true },
  );

  const columns: ColumnInfo[] = [];
  for (const row of result.rows) {
    const name = row['column_name'];
    const cqlType = row['type'];
    if (typeof name !== 'string' || typeof cqlType !== 'string') continue;
    const kind = normalizeKind(row['kind']);
    const positionRaw = row['position'];
    const position =
      typeof positionRaw === 'number'
        ? positionRaw
        : typeof positionRaw === 'bigint'
          ? Number(positionRaw)
          : -1;
    const clustering_order = normalizeClusteringOrder(row['clustering_order']);

    columns.push({
      name,
      cql_type: cqlType,
      kind,
      position,
      clustering_order,
    });
  }

  // Sort partition + clustering keys by position; everything else alphabetically
  // after the keys. Keep partition keys first, then clustering, then the rest.
  columns.sort((a, b) => {
    const order: Record<ColumnKind, number> = {
      partition_key: 0,
      clustering: 1,
      regular: 2,
      static: 3,
    };
    const ao = order[a.kind];
    const bo = order[b.kind];
    if (ao !== bo) return ao - bo;
    if (a.kind === 'partition_key' || a.kind === 'clustering') {
      return a.position - b.position;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    keyspace,
    table_name: table,
    columns,
  };
}
