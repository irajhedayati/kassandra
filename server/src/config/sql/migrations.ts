/**
 * Schema migrations of the relational backends, applied in key order by the
 * Kysely migrator (which records them in its `kysely_migration` table). Add a
 * new entry for every schema change and never edit one that has shipped.
 *
 * The same definition creates the schema on PostgreSQL and MySQL; the places
 * where they differ are marked:
 *  - MySQL ignores a column-level REFERENCES, so foreign keys are table constraints;
 *  - MySQL cannot index unbounded `text`, so indexed columns are varchar(190)
 *    (190 characters keep a composite key within InnoDB's 3072 byte limit);
 *  - MySQL gives `text` no default value, so no column has one: the repository always supplies them;
 *  - MySQL tables use a binary, case-sensitive and trailing-space-sensitive collation like PostgreSQL;
 *  - MySQL commits DDL as it goes, so every statement is `if not exists` and a half-applied migration can be rerun.
 */
import { sql, type ColumnDefinitionBuilder, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { SqlDialect } from '@kassandra/shared';

/** utf8mb4 with a binary, NO PAD collation: utf8mb4_0900_bin on MySQL 8, utf8mb4_nopad_bin on MariaDB. */
async function mysqlCollation(db: Kysely<any>): Promise<string> {
  const { rows } = await sql<{ v: string }>`select version() as v`.execute(db);
  return /mariadb/i.test(rows[0]?.v ?? '') ? 'utf8mb4_nopad_bin' : 'utf8mb4_0900_bin';
}

export function createMigrations(dialect: SqlDialect): Record<string, Migration> {
  const mysql = dialect === 'mysql';
  const key = mysql ? sql`varchar(190)` : 'text';
  const longText = mysql ? sql`longtext` : 'text';
  const identity = (c: ColumnDefinitionBuilder) => (mysql ? c.autoIncrement() : c.generatedAlwaysAsIdentity());
  const cascade = (cb: any) => cb.onDelete('cascade').onUpdate('cascade');

  return {
    '0000_init': {
      // The schema types describe the latest shape, not this one, hence `any`.
      async up(db: Kysely<any>) {
        const options = mysql ? sql`engine = InnoDB default charset = utf8mb4 collate ${sql.raw(await mysqlCollation(db))}` : null;
        const table = (name: string) => {
          const builder = db.schema.createTable(name).ifNotExists();
          return options ? builder.modifyEnd(options) : builder;
        };

        await table('connections')
          .addColumn('name', key, (c) => c.notNull())
          .addColumn('seq', 'integer', (c) => identity(c.notNull()))
          .addColumn('port', 'integer', (c) => c.notNull())
          .addColumn('username', key, (c) => c.notNull())
          .addColumn('password', 'text', (c) => c.notNull())
          .addColumn('ssl_enabled', 'boolean', (c) => c.notNull())
          .addColumn('ssl_protocol', key, (c) => c.notNull())
          .addColumn('ssl_cert_path', 'text', (c) => c.notNull())
          .addColumn('default_keyspace', key, (c) => c.notNull())
          .addColumn('consistency_level', key, (c) => c.notNull())
          .addColumn('connection_timeout', 'integer', (c) => c.notNull())
          .addColumn('protocol_version', 'integer', (c) => c.notNull())
          .addColumn('local_datacenter', key, (c) => c.notNull())
          .addPrimaryKeyConstraint('connections_pk', ['name'])
          .addUniqueConstraint('connections_seq_unique', ['seq'])
          .execute();

        await table('connection_hosts')
          .addColumn('connection_name', key, (c) => c.notNull())
          .addColumn('position', 'integer', (c) => c.notNull())
          .addColumn('host', 'text', (c) => c.notNull())
          .addPrimaryKeyConstraint('connection_hosts_pk', ['connection_name', 'position'])
          .addForeignKeyConstraint('connection_hosts_connection_fk', ['connection_name'], 'connections', ['name'], cascade)
          .execute();

        await table('app_state')
          .addColumn('id', 'integer', (c) => c.notNull())
          .addColumn('last_connection', key)
          .addPrimaryKeyConstraint('app_state_pk', ['id'])
          .addForeignKeyConstraint('app_state_connection_fk', ['last_connection'], 'connections', ['name'], (cb) =>
            cb.onDelete('set null').onUpdate('cascade'),
          )
          .addCheckConstraint('app_state_single_row', sql`id = 1`)
          .execute();

        await table('favorite_keyspaces')
          .addColumn('connection_name', key, (c) => c.notNull())
          .addColumn('keyspace', key, (c) => c.notNull())
          .addColumn('position', 'integer', (c) => c.notNull())
          .addPrimaryKeyConstraint('favorite_keyspaces_pk', ['connection_name', 'keyspace'])
          .addForeignKeyConstraint('favorite_keyspaces_connection_fk', ['connection_name'], 'connections', ['name'], cascade)
          .execute();

        await table('saved_queries')
          .addColumn('id', key, (c) => c.notNull())
          .addColumn('name', key, (c) => c.notNull())
          .addColumn('description', 'text', (c) => c.notNull())
          .addColumn('query', longText, (c) => c.notNull())
          .addColumn('position', 'integer', (c) => c.notNull())
          .addPrimaryKeyConstraint('saved_queries_pk', ['id'])
          .addUniqueConstraint('saved_queries_name_unique', ['name'])
          .execute();

        await table('saved_query_params')
          .addColumn('query_id', key, (c) => c.notNull())
          .addColumn('name', key, (c) => c.notNull())
          .addColumn('type', key, (c) => c.notNull())
          .addColumn('position', 'integer', (c) => c.notNull())
          .addPrimaryKeyConstraint('saved_query_params_pk', ['query_id', 'name'])
          .addForeignKeyConstraint('saved_query_params_query_fk', ['query_id'], 'saved_queries', ['id'], (cb) =>
            cb.onDelete('cascade'),
          )
          .execute();

        await table('table_metadata')
          .addColumn('id', 'integer', (c) => identity(c.notNull()))
          .addColumn('connection_name', key, (c) => c.notNull())
          .addColumn('keyspace', key, (c) => c.notNull())
          .addColumn('table_name', key, (c) => c.notNull())
          .addPrimaryKeyConstraint('table_metadata_pk', ['id'])
          .addUniqueConstraint('table_metadata_unique', ['connection_name', 'keyspace', 'table_name'])
          .addForeignKeyConstraint('table_metadata_connection_fk', ['connection_name'], 'connections', ['name'], cascade)
          .execute();

        await table('column_metadata')
          .addColumn('id', 'integer', (c) => identity(c.notNull()))
          .addColumn('table_id', 'integer', (c) => c.notNull())
          .addColumn('column_name', key, (c) => c.notNull())
          .addColumn('hide', 'boolean')
          .addColumn('display_type', key)
          .addPrimaryKeyConstraint('column_metadata_pk', ['id'])
          .addUniqueConstraint('column_metadata_unique', ['table_id', 'column_name'])
          .addForeignKeyConstraint('column_metadata_table_fk', ['table_id'], 'table_metadata', ['id'], (cb) =>
            cb.onDelete('cascade'),
          )
          .execute();

        await table('column_enum_values')
          .addColumn('column_id', 'integer', (c) => c.notNull())
          .addColumn('position', 'integer', (c) => c.notNull())
          .addColumn('value', 'text', (c) => c.notNull())
          .addPrimaryKeyConstraint('column_enum_values_pk', ['column_id', 'position'])
          .addForeignKeyConstraint('column_enum_values_column_fk', ['column_id'], 'column_metadata', ['id'], (cb) =>
            cb.onDelete('cascade'),
          )
          .execute();

        await table('column_map_entries')
          .addColumn('id', 'integer', (c) => identity(c.notNull()))
          .addColumn('column_id', 'integer', (c) => c.notNull())
          .addColumn('position', 'integer', (c) => c.notNull())
          .addColumn('key', 'text', (c) => c.notNull())
          .addColumn('label', 'text', (c) => c.notNull())
          .addColumn('display_type', key)
          .addPrimaryKeyConstraint('column_map_entries_pk', ['id'])
          .addUniqueConstraint('column_map_entries_unique', ['column_id', 'position'])
          .addForeignKeyConstraint('column_map_entries_column_fk', ['column_id'], 'column_metadata', ['id'], (cb) =>
            cb.onDelete('cascade'),
          )
          .execute();

        await table('map_entry_enum_values')
          .addColumn('entry_id', 'integer', (c) => c.notNull())
          .addColumn('position', 'integer', (c) => c.notNull())
          .addColumn('value', 'text', (c) => c.notNull())
          .addPrimaryKeyConstraint('map_entry_enum_values_pk', ['entry_id', 'position'])
          .addForeignKeyConstraint('map_entry_enum_values_entry_fk', ['entry_id'], 'column_map_entries', ['id'], (cb) =>
            cb.onDelete('cascade'),
          )
          .execute();

        await table('meta')
          .addColumn('name', key, (c) => c.notNull())
          .addColumn('value', 'text', (c) => c.notNull())
          .addPrimaryKeyConstraint('meta_pk', ['name'])
          .execute();

        await table('lock')
          .addColumn('id', 'integer', (c) => c.notNull())
          .addColumn('owner', key, (c) => c.notNull())
          .addColumn('taken_at', 'bigint', (c) => c.notNull())
          .addPrimaryKeyConstraint('lock_pk', ['id'])
          .addCheckConstraint('lock_single_row', sql`id = 1`)
          .execute();
      },
    },
  };
}
