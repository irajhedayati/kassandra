/**
 * Relational schema of the SQLite backend (Drizzle).
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
 * CASCADE). Ordered lists carry a `position`. Changing this file means
 * generating a migration: `npm run db:generate -w server`, then commit the SQL
 * in server/drizzle together with it.
 */
import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const connections = sqliteTable('connections', {
  name: text('name').primaryKey(),
  port: integer('port').notNull(),
  username: text('username').notNull().default(''),
  password: text('password').notNull().default(''),
  sslEnabled: integer('ssl_enabled', { mode: 'boolean' }).notNull().default(false),
  sslProtocol: text('ssl_protocol').notNull(),
  sslCertPath: text('ssl_cert_path').notNull().default(''),
  defaultKeyspace: text('default_keyspace').notNull().default(''),
  consistencyLevel: text('consistency_level').notNull(),
  connectionTimeout: integer('connection_timeout').notNull(),
  protocolVersion: integer('protocol_version').notNull(),
  localDatacenter: text('local_datacenter').notNull().default(''),
});

export const connectionHosts = sqliteTable(
  'connection_hosts',
  {
    connectionName: text('connection_name')
      .notNull()
      .references(() => connections.name, { onDelete: 'cascade', onUpdate: 'cascade' }),
    position: integer('position').notNull(),
    host: text('host').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionName, t.position] })],
);

/** Single row (id = 1) holding the application state that is not a list. */
export const appState = sqliteTable(
  'app_state',
  {
    id: integer('id').primaryKey(),
    lastConnection: text('last_connection').references(() => connections.name, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
  },
  (t) => [check('app_state_single_row', sql`${t.id} = 1`)],
);

export const favoriteKeyspaces = sqliteTable(
  'favorite_keyspaces',
  {
    connectionName: text('connection_name')
      .notNull()
      .references(() => connections.name, { onDelete: 'cascade', onUpdate: 'cascade' }),
    keyspace: text('keyspace').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionName, t.keyspace] })],
);

export const savedQueries = sqliteTable(
  'saved_queries',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    query: text('query').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique('saved_queries_name_unique').on(t.name)],
);

/** Declared CQL type per `:parameter` of a saved query. */
export const savedQueryParams = sqliteTable(
  'saved_query_params',
  {
    queryId: text('query_id')
      .notNull()
      .references(() => savedQueries.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
  },
  (t) => [primaryKey({ columns: [t.queryId, t.name] })],
);

/** A Cassandra table of a connection that has column metadata. */
export const tableMetadata = sqliteTable(
  'table_metadata',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connectionName: text('connection_name')
      .notNull()
      .references(() => connections.name, { onDelete: 'cascade', onUpdate: 'cascade' }),
    keyspace: text('keyspace').notNull(),
    tableName: text('table_name').notNull(),
  },
  (t) => [unique('table_metadata_unique').on(t.connectionName, t.keyspace, t.tableName)],
);

export const columnMetadata = sqliteTable(
  'column_metadata',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tableId: integer('table_id')
      .notNull()
      .references(() => tableMetadata.id, { onDelete: 'cascade' }),
    columnName: text('column_name').notNull(),
    hide: integer('hide', { mode: 'boolean' }),
    displayType: text('display_type'),
  },
  (t) => [unique('column_metadata_unique').on(t.tableId, t.columnName)],
);

export const columnEnumValues = sqliteTable(
  'column_enum_values',
  {
    columnId: integer('column_id')
      .notNull()
      .references(() => columnMetadata.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.columnId, t.position] })],
);

/** One key of a map column's `map_schema`. */
export const columnMapEntries = sqliteTable(
  'column_map_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    columnId: integer('column_id')
      .notNull()
      .references(() => columnMetadata.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    displayType: text('display_type'),
  },
  (t) => [unique('column_map_entries_unique').on(t.columnId, t.position)],
);

export const mapEntryEnumValues = sqliteTable(
  'map_entry_enum_values',
  {
    entryId: integer('entry_id')
      .notNull()
      .references(() => columnMapEntries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.position] })],
);

/** Name/value pairs about the data itself; currently only `version`. */
export const meta = sqliteTable('meta', {
  name: text('name').primaryKey(),
  value: text('value').notNull(),
});

/** At most one row: whoever holds it owns the lock. */
export const lock = sqliteTable(
  'lock',
  {
    id: integer('id').primaryKey(),
    owner: text('owner').notNull(),
    takenAt: integer('taken_at').notNull(),
  },
  (t) => [check('lock_single_row', sql`${t.id} = 1`)],
);
