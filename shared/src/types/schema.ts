/**
 * Cassandra schema model. Mirrors legacy/src/database/model.py.
 */

export type ColumnKind = 'partition_key' | 'clustering' | 'regular' | 'static';
export type ClusteringOrder = 'ASC' | 'DESC';

export interface ColumnInfo {
  name: string;
  /** Raw CQL type string, e.g. "text", "list<text>", "map<text, int>", "frozen<map<text, text>>" */
  cql_type: string;
  kind: ColumnKind;
  position: number;
  clustering_order: ClusteringOrder;
}

export interface TableSchema {
  keyspace: string;
  table_name: string;
  columns: ColumnInfo[];
}

export interface KeyspaceList {
  keyspaces: string[];
}

export interface TableList {
  tables: string[];
}

export type ReplicationStrategy = 'SimpleStrategy' | 'NetworkTopologyStrategy';

/** Body of POST /api/schema/keyspaces. Mirrors CQL CREATE KEYSPACE. */
export interface CreateKeyspaceRequest {
  name: string;
  strategy: ReplicationStrategy;
  /** SimpleStrategy only. */
  replicationFactor?: number;
  /** NetworkTopologyStrategy only: datacenter name → replicas. */
  datacenters?: Record<string, number>;
  durableWrites: boolean;
  ifNotExists: boolean;
}

export type CompactionStrategy =
  | 'SizeTieredCompactionStrategy'
  | 'LeveledCompactionStrategy'
  | 'TimeWindowCompactionStrategy';

export type CompressionAlgorithm =
  | 'LZ4Compressor'
  | 'SnappyCompressor'
  | 'DeflateCompressor'
  | 'none';

export interface CreateTableColumn {
  name: string;
  /** Full CQL type, e.g. `text`, `list<int>`, `frozen<map<text, int>>`. */
  type: string;
  /** Position in the primary key follows the order of the columns array. */
  kind: ColumnKind;
  /** Clustering columns only. */
  order?: ClusteringOrder;
}

/** Body of POST /api/schema/keyspaces/:keyspace/tables. Mirrors CQL CREATE TABLE. */
export interface CreateTableRequest {
  keyspace: string;
  name: string;
  ifNotExists: boolean;
  columns: CreateTableColumn[];
  comment?: string;
  defaultTimeToLive?: number;
  gcGraceSeconds?: number;
  compaction?: CompactionStrategy;
  compression?: CompressionAlgorithm;
}
