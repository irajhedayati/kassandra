/**
 * ConfigRepository on a PostgreSQL database (pg + Kysely) with the relational
 * schema in schema.ts, so several Kassandra instances can share one config.
 *
 * The schema is created and upgraded by the migrations in migrations.ts
 * (applied by migrate()); the `meta` table records which Kassandra version last
 * wrote the data. Every mutation is one transaction, so a crash never leaves
 * half a profile or half a table behind. The tables live in one PostgreSQL
 * schema (`public` unless told otherwise), which is created on migrate().
 */
import crypto from 'node:crypto';
import { Kysely, PostgresDialect, sql, type Selectable } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import type { ColumnMetadata, ConnectionProfile, SavedQuery, SavedQueryInput } from '@kassandra/shared';
import {
  normalizeProfile,
  SavedQueryError,
  type ConfigRepository,
  type ConfigSnapshot,
  type LockOptions,
  type TableColumns,
  type TableRef,
  type TableSummary,
} from '../repository.js';
import { compareVersions, getAppVersion } from '../version.js';
import { migrations } from './migrations.js';
import type { Database } from './schema.js';

const VERSION_ROW = 'version';
const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The database, or a transaction on it: both run queries. */
type Db = Kysely<Database>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Group `rows` by `key`, keeping their order. */
function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

/** Byte-wise ordering, so lists sort the same whatever the database collation. */
const byText = (column: string) => sql`${sql.ref(column)} collate "C"`;

export interface PostgresOptions {
  /** PostgreSQL schema holding the tables. Default `public`. */
  schema?: string;
}

export class PostgresRepository implements ConfigRepository {
  private readonly db: Db;
  private readonly pool: pg.Pool;
  readonly schema: string;
  private closed: Promise<void> | null = null;

  constructor(readonly url: string, { schema = 'public' }: PostgresOptions = {}) {
    if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid PostgreSQL schema name "${schema}"`);
    this.schema = schema;
    this.pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 10_000,
    });
    // An idle client dropped by the server must not crash the process; the pool replaces it.
    this.pool.on('error', (err) => console.warn(`[kassandra] PostgreSQL connection error: ${err.message}`));
    this.db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: this.pool }) });
  }

  get description(): string {
    // Never include the credentials of the URL.
    try {
      const u = new URL(this.url);
      return `PostgreSQL database ${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname} (schema ${this.schema})`;
    } catch {
      return `PostgreSQL database (schema ${this.schema})`;
    }
  }

  // --- lifecycle ---------------------------------------------------------------------------

  /** Names of the migrations recorded as applied, [] if the migrator has never run here. */
  private async appliedMigrations(): Promise<string[]> {
    const exists = await sql<{ found: boolean }>`select to_regclass('kysely_migration') is not null as found`.execute(this.db);
    if (!exists.rows[0]?.found) return [];
    const { rows } = await sql<{ name: string }>`select name from kysely_migration order by name`.execute(this.db);
    return rows.map((r) => r.name);
  }

  async migrate(): Promise<string[]> {
    await sql`create schema if not exists ${sql.id(this.schema)}`.execute(this.db);
    const known = Object.keys(migrations);
    const before = await this.appliedMigrations();
    if (before.some((name) => !known.includes(name))) {
      throw new Error(
        `${this.description} has database schema ${before.length}, newer than this version of Kassandra understands (${known.length})`,
      );
    }
    // Without migrationTableSchema the migrator treats its tables in *any* schema as its own, so a second schema in
    // the same database would never get them.
    const migrator = new Migrator({
      db: this.db,
      provider: { getMigrations: async () => migrations },
      migrationTableSchema: this.schema,
    });
    const { error, results } = await migrator.migrateToLatest();
    if (error) throw error;
    const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
    for (const name of applied) console.log(`[kassandra] applied database migration ${name} to ${this.description}`);

    const appVersion = getAppVersion();
    const current = await this.getVersion();
    if (current === null || compareVersions(current, appVersion) < 0) {
      await this.setVersionRow(this.db, appVersion);
    } else if (compareVersions(current, appVersion) > 0) {
      console.warn(`[kassandra] config in ${this.description} was written by ${current}, newer than this version (${appVersion})`);
    }
    return applied;
  }

  private async setVersionRow(db: Db, version: string): Promise<void> {
    await db
      .insertInto('meta')
      .values({ name: VERSION_ROW, value: version })
      .onConflict((oc) => oc.column('name').doUpdateSet({ value: version }))
      .execute();
  }

  async getVersion(): Promise<string | null> {
    const row = await this.db.selectFrom('meta').select('value').where('name', '=', VERSION_ROW).executeTakeFirst();
    return row?.value || null;
  }

  async isEmpty(): Promise<boolean> {
    const rows = async (table: 'connections' | 'saved_queries' | 'table_metadata') =>
      Number((await this.db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);
    return (await rows('connections')) + (await rows('saved_queries')) + (await rows('table_metadata')) === 0;
  }

  async exportSnapshot(): Promise<ConfigSnapshot> {
    const favorites: Record<string, string[]> = {};
    const rows = await this.db.selectFrom('favorite_keyspaces').selectAll().orderBy('position').execute();
    for (const row of rows) (favorites[row.connection_name] ??= []).push(row.keyspace);
    const tables: ConfigSnapshot['tables'] = [];
    for (const { columns: _count, ...ref } of await this.listTables()) {
      tables.push({ ...ref, columns: await this.getTableMetadata(ref) });
    }
    return {
      version: await this.getVersion(),
      settings: {
        connections: await this.listProfiles(),
        last_connection_name: await this.getLastConnection(),
        favorite_keyspaces: favorites,
        saved_queries: await this.listSavedQueries(),
      },
      tables,
    };
  }

  async importSnapshot(snapshot: ConfigSnapshot): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const known = new Set<string>();
      for (const profile of snapshot.settings.connections) {
        await this.writeProfile(tx, normalizeProfile(profile));
        known.add(profile.name);
      }
      const last = snapshot.settings.last_connection_name;
      await this.writeLastConnection(tx, known.has(last) ? last : null);
      for (const [connection, keyspaces] of Object.entries(snapshot.settings.favorite_keyspaces)) {
        if (!known.has(connection)) continue;
        for (const keyspace of keyspaces) await this.writeFavorite(tx, connection, keyspace);
      }
      for (const query of snapshot.settings.saved_queries) await this.writeNewQuery(tx, query);
      for (const { columns, ...ref } of snapshot.tables) {
        if (known.has(ref.connection)) await this.writeTable(tx, ref, columns);
      }
      if (snapshot.version) await this.setVersionRow(tx, snapshot.version);
    });
  }

  async lock({ timeoutMs = 60_000, staleMs = 300_000 }: LockOptions = {}): Promise<() => Promise<void>> {
    const owner = crypto.randomUUID();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const now = Date.now();
      // One statement: taking over a stale lock and claiming it cannot interleave with another process.
      const claimed = await this.db
        .insertInto('lock')
        .values({ id: 1, owner, taken_at: now })
        .onConflict((oc) =>
          oc
            .column('id')
            .doUpdateSet({ owner, taken_at: now })
            .where('lock.taken_at', '<', now - staleMs),
        )
        .executeTakeFirst();
      if ((claimed.numInsertedOrUpdatedRows ?? 0n) > 0n) {
        return async () => {
          await this.db.deleteFrom('lock').where('id', '=', 1).where('owner', '=', owner).execute();
        };
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for another process to release the lock in ${this.description}`);
      }
      await sleep(100);
    }
  }

  /** Close the connection pool and wait until it is closed. Safe to call twice. */
  destroy(): Promise<void> {
    this.closed ??= this.db.destroy();
    return this.closed;
  }

  close(): void {
    this.destroy().catch(() => {});
  }

  // --- connection profiles -----------------------------------------------------------------

  private toProfile(row: Selectable<Database['connections']>, hosts: string[]): ConnectionProfile {
    return normalizeProfile({
      name: row.name,
      hosts,
      port: row.port,
      username: row.username,
      password: row.password,
      ssl_enabled: row.ssl_enabled,
      ssl_protocol: row.ssl_protocol as ConnectionProfile['ssl_protocol'],
      ssl_cert_path: row.ssl_cert_path,
      default_keyspace: row.default_keyspace,
      consistency_level: row.consistency_level as ConnectionProfile['consistency_level'],
      connection_timeout: row.connection_timeout,
      protocol_version: row.protocol_version,
      local_datacenter: row.local_datacenter,
    });
  }

  private async writeProfile(tx: Db, profile: ConnectionProfile): Promise<void> {
    const values = {
      name: profile.name,
      port: profile.port,
      username: profile.username,
      password: profile.password,
      ssl_enabled: profile.ssl_enabled,
      ssl_protocol: profile.ssl_protocol,
      ssl_cert_path: profile.ssl_cert_path,
      default_keyspace: profile.default_keyspace,
      consistency_level: profile.consistency_level,
      connection_timeout: profile.connection_timeout,
      protocol_version: profile.protocol_version,
      local_datacenter: profile.local_datacenter,
    };
    // An upsert, not delete + insert: replacing the row would cascade to the profile's favorites and metadata.
    await tx
      .insertInto('connections')
      .values(values)
      .onConflict((oc) => oc.column('name').doUpdateSet(values))
      .execute();
    await tx.deleteFrom('connection_hosts').where('connection_name', '=', profile.name).execute();
    await tx
      .insertInto('connection_hosts')
      .values(profile.hosts.map((host, position) => ({ connection_name: profile.name, position, host })))
      .execute();
  }

  async listProfiles(): Promise<ConnectionProfile[]> {
    const rows = await this.db.selectFrom('connections').selectAll().orderBy('seq').execute();
    const hosts = groupBy(
      await this.db.selectFrom('connection_hosts').selectAll().orderBy('position').execute(),
      (h) => h.connection_name,
    );
    return rows.map((row) =>
      this.toProfile(
        row,
        (hosts.get(row.name) ?? []).map((h) => h.host),
      ),
    );
  }

  async getProfile(name: string): Promise<ConnectionProfile | null> {
    const row = await this.db.selectFrom('connections').selectAll().where('name', '=', name).executeTakeFirst();
    if (!row) return null;
    const hosts = await this.db
      .selectFrom('connection_hosts')
      .select('host')
      .where('connection_name', '=', name)
      .orderBy('position')
      .execute();
    return this.toProfile(
      row,
      hosts.map((h) => h.host),
    );
  }

  async upsertProfile(profile: ConnectionProfile): Promise<ConnectionProfile> {
    await this.db.transaction().execute((tx) => this.writeProfile(tx, normalizeProfile(profile)));
    return profile;
  }

  async deleteProfile(name: string): Promise<void> {
    // Hosts, favorites and table metadata go with it (ON DELETE CASCADE); the last connection is cleared (SET NULL).
    await this.db.deleteFrom('connections').where('name', '=', name).execute();
  }

  private async writeLastConnection(tx: Db, name: string | null): Promise<void> {
    await tx
      .insertInto('app_state')
      .values({ id: 1, last_connection: name })
      .onConflict((oc) => oc.column('id').doUpdateSet({ last_connection: name }))
      .execute();
  }

  async getLastConnection(): Promise<string> {
    const row = await this.db.selectFrom('app_state').select('last_connection').where('id', '=', 1).executeTakeFirst();
    return row?.last_connection ?? '';
  }

  async setLastConnection(name: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const exists =
        name !== '' && (await tx.selectFrom('connections').select('name').where('name', '=', name).executeTakeFirst());
      await this.writeLastConnection(tx, exists ? name : null);
    });
  }

  // --- favorite keyspaces ------------------------------------------------------------------

  private async favorites(tx: Db, profile: string): Promise<string[]> {
    const rows = await tx
      .selectFrom('favorite_keyspaces')
      .select('keyspace')
      .where('connection_name', '=', profile)
      .orderBy('position')
      .execute();
    return rows.map((r) => r.keyspace);
  }

  private async writeFavorite(tx: Db, connection: string, keyspace: string): Promise<void> {
    const last = await tx
      .selectFrom('favorite_keyspaces')
      .select((eb) => eb.fn.max('position').as('n'))
      .where('connection_name', '=', connection)
      .executeTakeFirst();
    await tx
      .insertInto('favorite_keyspaces')
      .values({ connection_name: connection, keyspace, position: (last?.n ?? -1) + 1 })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async getFavoriteKeyspaces(profile: string): Promise<string[]> {
    return this.favorites(this.db, profile);
  }

  async addFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]> {
    return this.db.transaction().execute(async (tx) => {
      await this.requireConnection(tx, profile);
      await this.writeFavorite(tx, profile, keyspace);
      return this.favorites(tx, profile);
    });
  }

  async removeFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]> {
    return this.db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom('favorite_keyspaces')
        .where('connection_name', '=', profile)
        .where('keyspace', '=', keyspace)
        .execute();
      return this.favorites(tx, profile);
    });
  }

  private async requireConnection(tx: Db, name: string): Promise<void> {
    if (!(await tx.selectFrom('connections').select('name').where('name', '=', name).executeTakeFirst())) {
      throw new Error(`Unknown connection "${name}"`);
    }
  }

  // --- saved queries -----------------------------------------------------------------------

  private async toQueries(tx: Db, rows: Database['saved_queries'][]): Promise<SavedQuery[]> {
    const params = groupBy(await tx.selectFrom('saved_query_params').selectAll().orderBy('position').execute(), (p) => p.query_id);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      query: row.query,
      paramTypes: Object.fromEntries((params.get(row.id) ?? []).map((p) => [p.name, p.type])),
    }));
  }

  private async writeParams(tx: Db, id: string, paramTypes: Record<string, string>): Promise<void> {
    await tx.deleteFrom('saved_query_params').where('query_id', '=', id).execute();
    const rows = Object.entries(paramTypes).map(([name, type], position) => ({ query_id: id, name, type, position }));
    if (rows.length > 0) await tx.insertInto('saved_query_params').values(rows).execute();
  }

  /** Insert a query with its id, at the end of the list. */
  private async writeNewQuery(tx: Db, query: SavedQuery): Promise<void> {
    const last = await tx
      .selectFrom('saved_queries')
      .select((eb) => eb.fn.max('position').as('n'))
      .executeTakeFirst();
    await tx
      .insertInto('saved_queries')
      .values({
        id: query.id,
        name: query.name,
        description: query.description,
        query: query.query,
        position: (last?.n ?? -1) + 1,
      })
      .execute();
    await this.writeParams(tx, query.id, query.paramTypes);
  }

  private async writeExistingQuery(tx: Db, id: string, input: SavedQueryInput): Promise<SavedQuery> {
    await tx
      .updateTable('saved_queries')
      .set({ name: input.name, description: input.description, query: input.query })
      .where('id', '=', id)
      .execute();
    await this.writeParams(tx, id, input.paramTypes);
    return { id, ...input };
  }

  async listSavedQueries(): Promise<SavedQuery[]> {
    return this.toQueries(this.db, await this.db.selectFrom('saved_queries').selectAll().orderBy('position').execute());
  }

  async createSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
    return this.db.transaction().execute(async (tx) => {
      if (await tx.selectFrom('saved_queries').select('id').where('name', '=', input.name).executeTakeFirst()) {
        throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
      }
      const created: SavedQuery = { id: crypto.randomUUID(), ...input };
      await this.writeNewQuery(tx, created);
      return created;
    });
  }

  async updateSavedQuery(id: string, input: SavedQueryInput): Promise<SavedQuery> {
    return this.db.transaction().execute(async (tx) => {
      if (!(await tx.selectFrom('saved_queries').select('id').where('id', '=', id).executeTakeFirst())) {
        throw new SavedQueryError('Saved query not found', 404);
      }
      const clash = await tx
        .selectFrom('saved_queries')
        .select('id')
        .where('name', '=', input.name)
        .where('id', '<>', id)
        .executeTakeFirst();
      if (clash) throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
      return this.writeExistingQuery(tx, id, input);
    });
  }

  async deleteSavedQuery(id: string): Promise<void> {
    const result = await this.db.deleteFrom('saved_queries').where('id', '=', id).executeTakeFirst();
    if (result.numDeletedRows === 0n) throw new SavedQueryError('Saved query not found', 404);
  }

  async importSavedQueries(inputs: SavedQueryInput[]): Promise<{ created: number; updated: number }> {
    return this.db.transaction().execute(async (tx) => {
      let created = 0;
      let updated = 0;
      for (const input of inputs) {
        const existing = await tx.selectFrom('saved_queries').select('id').where('name', '=', input.name).executeTakeFirst();
        if (existing) {
          await this.writeExistingQuery(tx, existing.id, input);
          updated++;
        } else {
          await this.writeNewQuery(tx, { id: crypto.randomUUID(), ...input });
          created++;
        }
      }
      return { created, updated };
    });
  }

  // --- table metadata ----------------------------------------------------------------------

  private async findTable(tx: Db, ref: TableRef): Promise<number | undefined> {
    const row = await tx
      .selectFrom('table_metadata')
      .select('id')
      .where('connection_name', '=', ref.connection)
      .where('keyspace', '=', ref.keyspace)
      .where('table_name', '=', ref.table)
      .executeTakeFirst();
    return row?.id;
  }

  private async ensureTable(tx: Db, ref: TableRef): Promise<number> {
    const existing = await this.findTable(tx, ref);
    if (existing !== undefined) return existing;
    await this.requireConnection(tx, ref.connection);
    const { id } = await tx
      .insertInto('table_metadata')
      .values({ connection_name: ref.connection, keyspace: ref.keyspace, table_name: ref.table })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  private async readColumns(tx: Db, tableId: number): Promise<TableColumns> {
    const columns = await tx.selectFrom('column_metadata').selectAll().where('table_id', '=', tableId).orderBy('id').execute();
    if (columns.length === 0) return {};
    const ids = columns.map((c) => c.id);
    const enums = groupBy(
      await tx.selectFrom('column_enum_values').selectAll().where('column_id', 'in', ids).orderBy('position').execute(),
      (e) => e.column_id,
    );
    const entries = groupBy(
      await tx.selectFrom('column_map_entries').selectAll().where('column_id', 'in', ids).orderBy('position').execute(),
      (e) => e.column_id,
    );
    const entryIds = [...entries.values()].flat().map((e) => e.id);
    const entryEnums = groupBy(
      entryIds.length === 0
        ? []
        : await tx
            .selectFrom('map_entry_enum_values')
            .selectAll()
            .where('entry_id', 'in', entryIds)
            .orderBy('position')
            .execute(),
      (e) => e.entry_id,
    );

    const result: TableColumns = {};
    for (const column of columns) {
      const metadata: ColumnMetadata = {};
      if (column.hide !== null) metadata.hide = column.hide;
      if (column.display_type !== null) metadata.display_type = column.display_type;
      const values = enums.get(column.id);
      if (values) metadata.enum_values = values.map((v) => v.value);
      const mapEntries = entries.get(column.id);
      if (mapEntries) {
        metadata.map_schema = mapEntries.map((entry) => {
          const mapEntry: NonNullable<ColumnMetadata['map_schema']>[number] = { key: entry.key, label: entry.label };
          if (entry.display_type !== null) mapEntry.display_type = entry.display_type;
          const entryValues = entryEnums.get(entry.id);
          if (entryValues) mapEntry.enum_values = entryValues.map((v) => v.value);
          return mapEntry;
        });
      }
      result[column.column_name] = metadata;
    }
    return result;
  }

  /** Replace one column's rows (and, by cascade, its enum values and map entries). */
  private async writeColumn(tx: Db, tableId: number, column: string, metadata: ColumnMetadata): Promise<void> {
    await tx.deleteFrom('column_metadata').where('table_id', '=', tableId).where('column_name', '=', column).execute();
    const { id: columnId } = await tx
      .insertInto('column_metadata')
      .values({
        table_id: tableId,
        column_name: column,
        hide: metadata.hide ?? null,
        display_type: metadata.display_type ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (metadata.enum_values?.length) {
      await tx
        .insertInto('column_enum_values')
        .values(metadata.enum_values.map((value, position) => ({ column_id: columnId, position, value })))
        .execute();
    }
    const mapSchema = metadata.map_schema ?? [];
    for (const [position, entry] of mapSchema.entries()) {
      const { id: entryId } = await tx
        .insertInto('column_map_entries')
        .values({ column_id: columnId, position, key: entry.key, label: entry.label, display_type: entry.display_type ?? null })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (entry.enum_values?.length) {
        await tx
          .insertInto('map_entry_enum_values')
          .values(entry.enum_values.map((value, p) => ({ entry_id: entryId, position: p, value })))
          .execute();
      }
    }
  }

  private async writeTable(tx: Db, ref: TableRef, columns: TableColumns): Promise<void> {
    const tableId = await this.ensureTable(tx, ref);
    await tx.deleteFrom('column_metadata').where('table_id', '=', tableId).execute();
    for (const [column, metadata] of Object.entries(columns)) await this.writeColumn(tx, tableId, column, metadata);
  }

  async getTableMetadata(ref: TableRef): Promise<TableColumns> {
    const tableId = await this.findTable(this.db, ref);
    return tableId === undefined ? {} : this.readColumns(this.db, tableId);
  }

  async setColumnMetadata(ref: TableRef, column: string, metadata: ColumnMetadata): Promise<ColumnMetadata> {
    return this.db.transaction().execute(async (tx) => {
      const tableId = await this.ensureTable(tx, ref);
      const merged: ColumnMetadata = { ...((await this.readColumns(tx, tableId))[column] ?? {}), ...metadata };
      await this.writeColumn(tx, tableId, column, merged);
      return merged;
    });
  }

  async replaceTableMetadata(ref: TableRef, columns: TableColumns): Promise<void> {
    await this.db.transaction().execute((tx) => this.writeTable(tx, ref, columns));
  }

  async listTables(): Promise<TableSummary[]> {
    const rows = await this.db
      .selectFrom('table_metadata as t')
      .leftJoin('column_metadata as c', 'c.table_id', 't.id')
      .select(['t.connection_name', 't.keyspace', 't.table_name'])
      .select((eb) => eb.fn.count<string>('c.id').as('columns'))
      .groupBy('t.id')
      .orderBy(byText('t.connection_name'))
      .orderBy(byText('t.keyspace'))
      .orderBy(byText('t.table_name'))
      .execute();
    return rows.map((r) => ({
      connection: r.connection_name,
      keyspace: r.keyspace,
      table: r.table_name,
      columns: Number(r.columns),
    }));
  }
}

let shared: PostgresRepository | null = null;

/** The process-wide pool for `url` and `schema`; switching to another database closes the previous one. */
export function sharedPostgresRepository(url: string, schema?: string): PostgresRepository {
  if (shared?.url !== url || shared.schema !== (schema ?? 'public')) {
    shared?.close();
    shared = new PostgresRepository(url, { schema });
  }
  return shared;
}

/** Close the shared pool (it is reopened on demand). */
export function closeSharedPostgresRepository(): void {
  shared?.close();
  shared = null;
}
