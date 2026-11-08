/**
 * Relational schema of the PostgreSQL backend, as Kysely types. It mirrors the
 * SQLite schema (sqlite/schema.ts); migrations.ts creates it.
 *
 *   connections ─┬─ connection_hosts
 *                ├─ favorite_keyspaces
 *                ├─ app_state.last_connection          (at most one row)
 *                └─ table_metadata ── column_metadata ─┬─ column_enum_values
 *                                                      └─ column_map_entries ── map_entry_enum_values
 *   saved_queries ── saved_query_params
 *   meta (version of the data)   lock (cross-process lock, at most one row)
 *
 * Everything that belongs to a connection is deleted with it (ON DELETE
 * CASCADE). Ordered lists carry a `position`. Changing a table means adding a
 * migration to migrations.ts, never editing an applied one.
 */
import type { ColumnType, Generated } from 'kysely';

/** bigint comes back from `pg` as a string; it is written (and compared) as a number. */
type BigInt = ColumnType<string | number, number, number>;

export interface ConnectionsTable {
  name: string;
  /** Creation order, so profiles list in the order they were added. */
  seq: Generated<number>;
  port: number;
  username: string;
  password: string;
  ssl_enabled: boolean;
  ssl_protocol: string;
  ssl_cert_path: string;
  default_keyspace: string;
  consistency_level: string;
  connection_timeout: number;
  protocol_version: number;
  local_datacenter: string;
}

export interface ConnectionHostsTable {
  connection_name: string;
  position: number;
  host: string;
}

export interface AppStateTable {
  id: number;
  last_connection: string | null;
}

export interface FavoriteKeyspacesTable {
  connection_name: string;
  keyspace: string;
  position: number;
}

export interface SavedQueriesTable {
  id: string;
  name: string;
  description: string;
  query: string;
  position: number;
}

export interface SavedQueryParamsTable {
  query_id: string;
  name: string;
  type: string;
  position: number;
}

export interface TableMetadataTable {
  id: Generated<number>;
  connection_name: string;
  keyspace: string;
  table_name: string;
}

export interface ColumnMetadataTable {
  id: Generated<number>;
  table_id: number;
  column_name: string;
  hide: boolean | null;
  display_type: string | null;
}

export interface ColumnEnumValuesTable {
  column_id: number;
  position: number;
  value: string;
}

export interface ColumnMapEntriesTable {
  id: Generated<number>;
  column_id: number;
  position: number;
  key: string;
  label: string;
  display_type: string | null;
}

export interface MapEntryEnumValuesTable {
  entry_id: number;
  position: number;
  value: string;
}

export interface MetaTable {
  name: string;
  value: string;
}

export interface LockTable {
  id: number;
  owner: string;
  taken_at: BigInt;
}

export interface Database {
  connections: ConnectionsTable;
  connection_hosts: ConnectionHostsTable;
  app_state: AppStateTable;
  favorite_keyspaces: FavoriteKeyspacesTable;
  saved_queries: SavedQueriesTable;
  saved_query_params: SavedQueryParamsTable;
  table_metadata: TableMetadataTable;
  column_metadata: ColumnMetadataTable;
  column_enum_values: ColumnEnumValuesTable;
  column_map_entries: ColumnMapEntriesTable;
  map_entry_enum_values: MapEntryEnumValuesTable;
  meta: MetaTable;
  lock: LockTable;
}
