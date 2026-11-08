/**
 * Schema migrations of the PostgreSQL backend, applied in key order by the
 * Kysely migrator (which records them in its `kysely_migration` table). Add a
 * new entry for every schema change and never edit one that has shipped.
 */
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migrations: Record<string, Migration> = {
  '0000_init': {
    // The schema types describe the latest shape, not this one, hence `any`.
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('connections')
        .addColumn('name', 'text', (c) => c.primaryKey())
        .addColumn('seq', 'integer', (c) => c.generatedAlwaysAsIdentity().notNull())
        .addColumn('port', 'integer', (c) => c.notNull())
        .addColumn('username', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('password', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('ssl_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
        .addColumn('ssl_protocol', 'text', (c) => c.notNull())
        .addColumn('ssl_cert_path', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('default_keyspace', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('consistency_level', 'text', (c) => c.notNull())
        .addColumn('connection_timeout', 'integer', (c) => c.notNull())
        .addColumn('protocol_version', 'integer', (c) => c.notNull())
        .addColumn('local_datacenter', 'text', (c) => c.notNull().defaultTo(''))
        .execute();

      await db.schema
        .createTable('connection_hosts')
        .addColumn('connection_name', 'text', (c) =>
          c.notNull().references('connections.name').onDelete('cascade').onUpdate('cascade'),
        )
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('host', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('connection_hosts_pk', ['connection_name', 'position'])
        .execute();

      await db.schema
        .createTable('app_state')
        .addColumn('id', 'integer', (c) => c.primaryKey())
        .addColumn('last_connection', 'text', (c) => c.references('connections.name').onDelete('set null').onUpdate('cascade'))
        .addCheckConstraint('app_state_single_row', sql`id = 1`)
        .execute();

      await db.schema
        .createTable('favorite_keyspaces')
        .addColumn('connection_name', 'text', (c) =>
          c.notNull().references('connections.name').onDelete('cascade').onUpdate('cascade'),
        )
        .addColumn('keyspace', 'text', (c) => c.notNull())
        .addColumn('position', 'integer', (c) => c.notNull())
        .addPrimaryKeyConstraint('favorite_keyspaces_pk', ['connection_name', 'keyspace'])
        .execute();

      await db.schema
        .createTable('saved_queries')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('query', 'text', (c) => c.notNull())
        .addColumn('position', 'integer', (c) => c.notNull())
        .addUniqueConstraint('saved_queries_name_unique', ['name'])
        .execute();

      await db.schema
        .createTable('saved_query_params')
        .addColumn('query_id', 'text', (c) => c.notNull().references('saved_queries.id').onDelete('cascade'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('type', 'text', (c) => c.notNull())
        .addColumn('position', 'integer', (c) => c.notNull())
        .addPrimaryKeyConstraint('saved_query_params_pk', ['query_id', 'name'])
        .execute();

      await db.schema
        .createTable('table_metadata')
        .addColumn('id', 'integer', (c) => c.generatedAlwaysAsIdentity().primaryKey())
        .addColumn('connection_name', 'text', (c) =>
          c.notNull().references('connections.name').onDelete('cascade').onUpdate('cascade'),
        )
        .addColumn('keyspace', 'text', (c) => c.notNull())
        .addColumn('table_name', 'text', (c) => c.notNull())
        .addUniqueConstraint('table_metadata_unique', ['connection_name', 'keyspace', 'table_name'])
        .execute();

      await db.schema
        .createTable('column_metadata')
        .addColumn('id', 'integer', (c) => c.generatedAlwaysAsIdentity().primaryKey())
        .addColumn('table_id', 'integer', (c) => c.notNull().references('table_metadata.id').onDelete('cascade'))
        .addColumn('column_name', 'text', (c) => c.notNull())
        .addColumn('hide', 'boolean')
        .addColumn('display_type', 'text')
        .addUniqueConstraint('column_metadata_unique', ['table_id', 'column_name'])
        .execute();

      await db.schema
        .createTable('column_enum_values')
        .addColumn('column_id', 'integer', (c) => c.notNull().references('column_metadata.id').onDelete('cascade'))
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('value', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('column_enum_values_pk', ['column_id', 'position'])
        .execute();

      await db.schema
        .createTable('column_map_entries')
        .addColumn('id', 'integer', (c) => c.generatedAlwaysAsIdentity().primaryKey())
        .addColumn('column_id', 'integer', (c) => c.notNull().references('column_metadata.id').onDelete('cascade'))
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('key', 'text', (c) => c.notNull())
        .addColumn('label', 'text', (c) => c.notNull())
        .addColumn('display_type', 'text')
        .addUniqueConstraint('column_map_entries_unique', ['column_id', 'position'])
        .execute();

      await db.schema
        .createTable('map_entry_enum_values')
        .addColumn('entry_id', 'integer', (c) => c.notNull().references('column_map_entries.id').onDelete('cascade'))
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('value', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('map_entry_enum_values_pk', ['entry_id', 'position'])
        .execute();

      await db.schema
        .createTable('meta')
        .addColumn('name', 'text', (c) => c.primaryKey())
        .addColumn('value', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('lock')
        .addColumn('id', 'integer', (c) => c.primaryKey())
        .addColumn('owner', 'text', (c) => c.notNull())
        .addColumn('taken_at', 'bigint', (c) => c.notNull())
        .addCheckConstraint('lock_single_row', sql`id = 1`)
        .execute();
    },
  },
};
