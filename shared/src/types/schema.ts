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
