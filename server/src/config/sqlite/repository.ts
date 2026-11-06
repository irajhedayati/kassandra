/**
 * ConfigRepository on a SQLite database (better-sqlite3 + Drizzle) with the
 * relational schema in schema.ts.
 *
 * The schema is created and upgraded by the SQL migrations in server/drizzle
 * (generated with drizzle-kit, applied by migrate()); the `meta` table records
 * which Kassandra version last wrote the data. Every mutation is one
 * transaction, so a crash never leaves half a profile or half a table behind.
 */
import crypto from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, asc, count, eq, inArray, lt, max, ne, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as applyMigrations } from 'drizzle-orm/better-sqlite3/migrator';
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
import * as s from './schema.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));
const VERSION_ROW = 'version';

type Db = BetterSQLite3Database;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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

export class SqliteRepository implements ConfigRepository {
  private readonly sqlite: Database.Database;
  private readonly db: Db;

  constructor(readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.sqlite = new Database(file);
    try {
      this.sqlite.pragma('busy_timeout = 5000');
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('foreign_keys = ON');
    } catch (err) {
      this.sqlite.close();
      throw err;
    }
    this.db = drizzle(this.sqlite);
  }

  get description(): string {
    return `SQLite database ${this.file}`;
  }

  // --- lifecycle ---------------------------------------------------------------------------

  private appliedMigrations(): number {
    const table = this.sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get();
    if (!table) return 0;
    return (this.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
  }

  async migrate(): Promise<string[]> {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf-8')) as {
      entries: { tag: string }[];
    };
    const before = this.appliedMigrations();
    if (before > journal.entries.length) {
      throw new Error(
        `${this.file} has database schema ${before}, newer than this version of Kassandra understands (${journal.entries.length})`,
      );
    }
    applyMigrations(this.db, { migrationsFolder: MIGRATIONS_FOLDER });
    const applied = journal.entries.slice(before).map((e) => e.tag);
    for (const tag of applied) console.log(`[kassandra] applied database migration ${tag} to ${this.file}`);

    const appVersion = getAppVersion();
    const current = await this.getVersion();
    if (current === null || compareVersions(current, appVersion) < 0) {
      this.setVersionRow(appVersion);
    } else if (compareVersions(current, appVersion) > 0) {
      console.warn(`[kassandra] config in ${this.file} was written by ${current}, newer than this version (${appVersion})`);
    }
    return applied;
  }

  private setVersionRow(version: string): void {
    this.db
      .insert(s.meta)
      .values({ name: VERSION_ROW, value: version })
      .onConflictDoUpdate({ target: s.meta.name, set: { value: version } })
      .run();
  }

  async getVersion(): Promise<string | null> {
    const row = this.db.select().from(s.meta).where(eq(s.meta.name, VERSION_ROW)).get();
    return row?.value || null;
  }

  async isEmpty(): Promise<boolean> {
    const rows = (t: typeof s.connections | typeof s.savedQueries | typeof s.tableMetadata) =>
      this.db.select({ n: count() }).from(t).get()!.n;
    return rows(s.connections) + rows(s.savedQueries) + rows(s.tableMetadata) === 0;
  }

  async exportSnapshot(): Promise<ConfigSnapshot> {
    const favorites: Record<string, string[]> = {};
    for (const row of this.db.select().from(s.favoriteKeyspaces).orderBy(asc(s.favoriteKeyspaces.position)).all()) {
      (favorites[row.connectionName] ??= []).push(row.keyspace);
    }
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
    this.db.transaction((tx) => {
      const known = new Set<string>();
      for (const profile of snapshot.settings.connections) {
        this.writeProfile(tx, normalizeProfile(profile));
        known.add(profile.name);
      }
      const last = snapshot.settings.last_connection_name;
      this.writeLastConnection(tx, known.has(last) ? last : null);
      for (const [connection, keyspaces] of Object.entries(snapshot.settings.favorite_keyspaces)) {
        if (!known.has(connection)) continue;
        for (const keyspace of keyspaces) this.writeFavorite(tx, connection, keyspace);
      }
      for (const query of snapshot.settings.saved_queries) this.writeNewQuery(tx, query);
      for (const { columns, ...ref } of snapshot.tables) {
        if (known.has(ref.connection)) this.writeTable(tx, ref, columns);
      }
      if (snapshot.version) this.setVersionRow(snapshot.version);
    });
  }

  async lock({ timeoutMs = 60_000, staleMs = 300_000 }: LockOptions = {}): Promise<() => Promise<void>> {
    const owner = crypto.randomUUID();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const now = Date.now();
      // One statement: taking over a stale lock and claiming it cannot interleave with another process.
      const claimed = this.db
        .insert(s.lock)
        .values({ id: 1, owner, takenAt: now })
        .onConflictDoUpdate({
          target: s.lock.id,
          set: { owner, takenAt: now },
          setWhere: lt(s.lock.takenAt, now - staleMs),
        })
        .run();
      if (claimed.changes > 0) {
        return async () => {
          this.db.delete(s.lock).where(and(eq(s.lock.id, 1), eq(s.lock.owner, owner))).run();
        };
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for another process to release the lock in ${this.file}`);
      }
      await sleep(100);
    }
  }

  close(): void {
    if (this.sqlite.open) this.sqlite.close();
  }

  // --- connection profiles -----------------------------------------------------------------

  private toProfile(row: typeof s.connections.$inferSelect, hosts: string[]): ConnectionProfile {
    return normalizeProfile({
      name: row.name,
      hosts,
      port: row.port,
      username: row.username,
      password: row.password,
      ssl_enabled: row.sslEnabled,
      ssl_protocol: row.sslProtocol as ConnectionProfile['ssl_protocol'],
      ssl_cert_path: row.sslCertPath,
      default_keyspace: row.defaultKeyspace,
      consistency_level: row.consistencyLevel as ConnectionProfile['consistency_level'],
      connection_timeout: row.connectionTimeout,
      protocol_version: row.protocolVersion,
      local_datacenter: row.localDatacenter,
    });
  }

  private writeProfile(tx: Tx, profile: ConnectionProfile): void {
    const values = {
      name: profile.name,
      port: profile.port,
      username: profile.username,
      password: profile.password,
      sslEnabled: profile.ssl_enabled,
      sslProtocol: profile.ssl_protocol,
      sslCertPath: profile.ssl_cert_path,
      defaultKeyspace: profile.default_keyspace,
      consistencyLevel: profile.consistency_level,
      connectionTimeout: profile.connection_timeout,
      protocolVersion: profile.protocol_version,
      localDatacenter: profile.local_datacenter,
    };
    // An upsert, not delete + insert: replacing the row would cascade to the profile's favorites and metadata.
    tx.insert(s.connections).values(values).onConflictDoUpdate({ target: s.connections.name, set: values }).run();
    tx.delete(s.connectionHosts).where(eq(s.connectionHosts.connectionName, profile.name)).run();
    tx.insert(s.connectionHosts)
      .values(profile.hosts.map((host, position) => ({ connectionName: profile.name, position, host })))
      .run();
  }

  async listProfiles(): Promise<ConnectionProfile[]> {
    const rows = this.db.select().from(s.connections).orderBy(sql`rowid`).all();
    const hosts = groupBy(
      this.db.select().from(s.connectionHosts).orderBy(asc(s.connectionHosts.position)).all(),
      (h) => h.connectionName,
    );
    return rows.map((row) =>
      this.toProfile(
        row,
        (hosts.get(row.name) ?? []).map((h) => h.host),
      ),
    );
  }

  async getProfile(name: string): Promise<ConnectionProfile | null> {
    const row = this.db.select().from(s.connections).where(eq(s.connections.name, name)).get();
    if (!row) return null;
    const hosts = this.db
      .select()
      .from(s.connectionHosts)
      .where(eq(s.connectionHosts.connectionName, name))
      .orderBy(asc(s.connectionHosts.position))
      .all();
    return this.toProfile(
      row,
      hosts.map((h) => h.host),
    );
  }

  async upsertProfile(profile: ConnectionProfile): Promise<ConnectionProfile> {
    this.db.transaction((tx) => this.writeProfile(tx, normalizeProfile(profile)));
    return profile;
  }

  async deleteProfile(name: string): Promise<void> {
    // Hosts, favorites and table metadata go with it (ON DELETE CASCADE); the last connection is cleared (SET NULL).
    this.db.delete(s.connections).where(eq(s.connections.name, name)).run();
  }

  private writeLastConnection(tx: Tx, name: string | null): void {
    tx.insert(s.appState)
      .values({ id: 1, lastConnection: name })
      .onConflictDoUpdate({ target: s.appState.id, set: { lastConnection: name } })
      .run();
  }

  async getLastConnection(): Promise<string> {
    return this.db.select().from(s.appState).where(eq(s.appState.id, 1)).get()?.lastConnection ?? '';
  }

  async setLastConnection(name: string): Promise<void> {
    this.db.transaction((tx) => {
      const exists = name !== '' && tx.select().from(s.connections).where(eq(s.connections.name, name)).get();
      this.writeLastConnection(tx, exists ? name : null);
    });
  }

  // --- favorite keyspaces ------------------------------------------------------------------

  private favorites(tx: Db | Tx, profile: string): string[] {
    return tx
      .select()
      .from(s.favoriteKeyspaces)
      .where(eq(s.favoriteKeyspaces.connectionName, profile))
      .orderBy(asc(s.favoriteKeyspaces.position))
      .all()
      .map((r) => r.keyspace);
  }

  private writeFavorite(tx: Tx, connection: string, keyspace: string): void {
    const last = tx
      .select({ n: max(s.favoriteKeyspaces.position) })
      .from(s.favoriteKeyspaces)
      .where(eq(s.favoriteKeyspaces.connectionName, connection))
      .get();
    tx.insert(s.favoriteKeyspaces)
      .values({ connectionName: connection, keyspace, position: (last?.n ?? -1) + 1 })
      .onConflictDoNothing()
      .run();
  }

  async getFavoriteKeyspaces(profile: string): Promise<string[]> {
    return this.favorites(this.db, profile);
  }

  async addFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]> {
    return this.db.transaction((tx) => {
      this.requireConnection(tx, profile);
      this.writeFavorite(tx, profile, keyspace);
      return this.favorites(tx, profile);
    });
  }

  async removeFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]> {
    return this.db.transaction((tx) => {
      tx.delete(s.favoriteKeyspaces)
        .where(and(eq(s.favoriteKeyspaces.connectionName, profile), eq(s.favoriteKeyspaces.keyspace, keyspace)))
        .run();
      return this.favorites(tx, profile);
    });
  }

  private requireConnection(tx: Db | Tx, name: string): void {
    if (!tx.select().from(s.connections).where(eq(s.connections.name, name)).get()) {
      throw new Error(`Unknown connection "${name}"`);
    }
  }

  // --- saved queries -----------------------------------------------------------------------

  private toQueries(tx: Db | Tx, rows: (typeof s.savedQueries.$inferSelect)[]): SavedQuery[] {
    const params = groupBy(tx.select().from(s.savedQueryParams).orderBy(sql`rowid`).all(), (p) => p.queryId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      query: row.query,
      paramTypes: Object.fromEntries((params.get(row.id) ?? []).map((p) => [p.name, p.type])),
    }));
  }

  private writeParams(tx: Tx, id: string, paramTypes: Record<string, string>): void {
    tx.delete(s.savedQueryParams).where(eq(s.savedQueryParams.queryId, id)).run();
    const rows = Object.entries(paramTypes).map(([name, type]) => ({ queryId: id, name, type }));
    if (rows.length > 0) tx.insert(s.savedQueryParams).values(rows).run();
  }

  /** Insert a query with its id, at the end of the list. */
  private writeNewQuery(tx: Tx, query: SavedQuery): void {
    const last = tx.select({ n: max(s.savedQueries.position) }).from(s.savedQueries).get();
    tx.insert(s.savedQueries)
      .values({
        id: query.id,
        name: query.name,
        description: query.description,
        query: query.query,
        position: (last?.n ?? -1) + 1,
      })
      .run();
    this.writeParams(tx, query.id, query.paramTypes);
  }

  private writeExistingQuery(tx: Tx, id: string, input: SavedQueryInput): SavedQuery {
    tx.update(s.savedQueries)
      .set({ name: input.name, description: input.description, query: input.query })
      .where(eq(s.savedQueries.id, id))
      .run();
    this.writeParams(tx, id, input.paramTypes);
    return { id, ...input };
  }

  async listSavedQueries(): Promise<SavedQuery[]> {
    return this.toQueries(this.db, this.db.select().from(s.savedQueries).orderBy(asc(s.savedQueries.position)).all());
  }

  async createSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
    return this.db.transaction((tx) => {
      if (tx.select().from(s.savedQueries).where(eq(s.savedQueries.name, input.name)).get()) {
        throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
      }
      const created: SavedQuery = { id: crypto.randomUUID(), ...input };
      this.writeNewQuery(tx, created);
      return created;
    });
  }

  async updateSavedQuery(id: string, input: SavedQueryInput): Promise<SavedQuery> {
    return this.db.transaction((tx) => {
      if (!tx.select().from(s.savedQueries).where(eq(s.savedQueries.id, id)).get()) {
        throw new SavedQueryError('Saved query not found', 404);
      }
      const clash = tx
        .select()
        .from(s.savedQueries)
        .where(and(eq(s.savedQueries.name, input.name), ne(s.savedQueries.id, id)))
        .get();
      if (clash) throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
      return this.writeExistingQuery(tx, id, input);
    });
  }

  async deleteSavedQuery(id: string): Promise<void> {
    const result = this.db.delete(s.savedQueries).where(eq(s.savedQueries.id, id)).run();
    if (result.changes === 0) throw new SavedQueryError('Saved query not found', 404);
  }

  async importSavedQueries(inputs: SavedQueryInput[]): Promise<{ created: number; updated: number }> {
    return this.db.transaction((tx) => {
      let created = 0;
      let updated = 0;
      for (const input of inputs) {
        const existing = tx.select().from(s.savedQueries).where(eq(s.savedQueries.name, input.name)).get();
        if (existing) {
          this.writeExistingQuery(tx, existing.id, input);
          updated++;
        } else {
          this.writeNewQuery(tx, { id: crypto.randomUUID(), ...input });
          created++;
        }
      }
      return { created, updated };
    });
  }

  // --- table metadata ----------------------------------------------------------------------

  private findTable(tx: Db | Tx, ref: TableRef): number | undefined {
    return tx
      .select({ id: s.tableMetadata.id })
      .from(s.tableMetadata)
      .where(
        and(
          eq(s.tableMetadata.connectionName, ref.connection),
          eq(s.tableMetadata.keyspace, ref.keyspace),
          eq(s.tableMetadata.tableName, ref.table),
        ),
      )
      .get()?.id;
  }

  private ensureTable(tx: Tx, ref: TableRef): number {
    const existing = this.findTable(tx, ref);
    if (existing !== undefined) return existing;
    this.requireConnection(tx, ref.connection);
    return tx
      .insert(s.tableMetadata)
      .values({ connectionName: ref.connection, keyspace: ref.keyspace, tableName: ref.table })
      .returning({ id: s.tableMetadata.id })
      .get().id;
  }

  private readColumns(tx: Db | Tx, tableId: number): TableColumns {
    const columns = tx
      .select()
      .from(s.columnMetadata)
      .where(eq(s.columnMetadata.tableId, tableId))
      .orderBy(asc(s.columnMetadata.id))
      .all();
    if (columns.length === 0) return {};
    const ids = columns.map((c) => c.id);
    const enums = groupBy(
      tx
        .select()
        .from(s.columnEnumValues)
        .where(inArray(s.columnEnumValues.columnId, ids))
        .orderBy(asc(s.columnEnumValues.position))
        .all(),
      (e) => e.columnId,
    );
    const entries = groupBy(
      tx
        .select()
        .from(s.columnMapEntries)
        .where(inArray(s.columnMapEntries.columnId, ids))
        .orderBy(asc(s.columnMapEntries.position))
        .all(),
      (e) => e.columnId,
    );
    const entryIds = [...entries.values()].flat().map((e) => e.id);
    const entryEnums = groupBy(
      entryIds.length === 0
        ? []
        : tx
            .select()
            .from(s.mapEntryEnumValues)
            .where(inArray(s.mapEntryEnumValues.entryId, entryIds))
            .orderBy(asc(s.mapEntryEnumValues.position))
            .all(),
      (e) => e.entryId,
    );

    const result: TableColumns = {};
    for (const column of columns) {
      const metadata: ColumnMetadata = {};
      if (column.hide !== null) metadata.hide = column.hide;
      if (column.displayType !== null) metadata.display_type = column.displayType;
      const values = enums.get(column.id);
      if (values) metadata.enum_values = values.map((v) => v.value);
      const mapEntries = entries.get(column.id);
      if (mapEntries) {
        metadata.map_schema = mapEntries.map((entry) => {
          const mapEntry: NonNullable<ColumnMetadata['map_schema']>[number] = { key: entry.key, label: entry.label };
          if (entry.displayType !== null) mapEntry.display_type = entry.displayType;
          const entryValues = entryEnums.get(entry.id);
          if (entryValues) mapEntry.enum_values = entryValues.map((v) => v.value);
          return mapEntry;
        });
      }
      result[column.columnName] = metadata;
    }
    return result;
  }

  /** Replace one column's rows (and, by cascade, its enum values and map entries). */
  private writeColumn(tx: Tx, tableId: number, column: string, metadata: ColumnMetadata): void {
    tx.delete(s.columnMetadata)
      .where(and(eq(s.columnMetadata.tableId, tableId), eq(s.columnMetadata.columnName, column)))
      .run();
    const { id: columnId } = tx
      .insert(s.columnMetadata)
      .values({
        tableId,
        columnName: column,
        hide: metadata.hide ?? null,
        displayType: metadata.display_type ?? null,
      })
      .returning({ id: s.columnMetadata.id })
      .get();
    if (metadata.enum_values?.length) {
      tx.insert(s.columnEnumValues)
        .values(metadata.enum_values.map((value, position) => ({ columnId, position, value })))
        .run();
    }
    (metadata.map_schema ?? []).forEach((entry, position) => {
      const { id: entryId } = tx
        .insert(s.columnMapEntries)
        .values({ columnId, position, key: entry.key, label: entry.label, displayType: entry.display_type ?? null })
        .returning({ id: s.columnMapEntries.id })
        .get();
      if (entry.enum_values?.length) {
        tx.insert(s.mapEntryEnumValues)
          .values(entry.enum_values.map((value, p) => ({ entryId, position: p, value })))
          .run();
      }
    });
  }

  private writeTable(tx: Tx, ref: TableRef, columns: TableColumns): void {
    const tableId = this.ensureTable(tx, ref);
    tx.delete(s.columnMetadata).where(eq(s.columnMetadata.tableId, tableId)).run();
    for (const [column, metadata] of Object.entries(columns)) this.writeColumn(tx, tableId, column, metadata);
  }

  async getTableMetadata(ref: TableRef): Promise<TableColumns> {
    const tableId = this.findTable(this.db, ref);
    return tableId === undefined ? {} : this.readColumns(this.db, tableId);
  }

  async setColumnMetadata(ref: TableRef, column: string, metadata: ColumnMetadata): Promise<ColumnMetadata> {
    return this.db.transaction((tx) => {
      const tableId = this.ensureTable(tx, ref);
      const merged: ColumnMetadata = { ...(this.readColumns(tx, tableId)[column] ?? {}), ...metadata };
      this.writeColumn(tx, tableId, column, merged);
      return merged;
    });
  }

  async replaceTableMetadata(ref: TableRef, columns: TableColumns): Promise<void> {
    this.db.transaction((tx) => this.writeTable(tx, ref, columns));
  }

  async listTables(): Promise<TableSummary[]> {
    return this.db
      .select({
        connection: s.tableMetadata.connectionName,
        keyspace: s.tableMetadata.keyspace,
        table: s.tableMetadata.tableName,
        columns: count(s.columnMetadata.id),
      })
      .from(s.tableMetadata)
      .leftJoin(s.columnMetadata, eq(s.columnMetadata.tableId, s.tableMetadata.id))
      .groupBy(s.tableMetadata.id)
      .orderBy(asc(s.tableMetadata.connectionName), asc(s.tableMetadata.keyspace), asc(s.tableMetadata.tableName))
      .all();
  }
}

let shared: SqliteRepository | null = null;

/** The process-wide connection to `file`; switching to another file closes the previous one. */
export function sharedSqliteRepository(file: string): SqliteRepository {
  if (shared?.file !== file) {
    shared?.close();
    shared = new SqliteRepository(file);
  }
  return shared;
}

/** Close the shared connection (it is reopened on demand). */
export function closeSharedSqliteRepository(): void {
  shared?.close();
  shared = null;
}
