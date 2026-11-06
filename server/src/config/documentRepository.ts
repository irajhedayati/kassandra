/**
 * ConfigRepository on top of a ConfigStorage (key -> JSON document):
 *
 *   config                       AppSettings: profiles, last connection, favorites, saved queries
 *   tables/<conn>-<ks>.<table>   per-table column metadata (see tables.ts)
 *
 * Every mutation reads a whole document, changes it and writes it back, so the
 * caller must not run them concurrently (store.ts serializes them).
 */
import crypto from 'node:crypto';
import type { AppSettings, ColumnMetadata, ConnectionProfile, SavedQuery, SavedQueryInput } from '@kassandra/shared';
import { runMigrations } from './migrations/index.js';
import {
  normalizeProfile,
  SavedQueryError,
  type ConfigRepository,
  type ConfigSnapshot,
  type LockOptions,
  type TableColumns,
  type TableRef,
  type TableSummary,
} from './repository.js';
import type { ConfigStorage } from './storage.js';
import {
  deleteConnectionTables,
  listTableFiles,
  readTableMetadata,
  writeTableMetadata,
} from './tables.js';
import { initConfigVersion } from './version.js';

const CONFIG_KEY = 'config';

function defaultSettings(): AppSettings {
  return { connections: [], last_connection_name: '', favorite_keyspaces: {}, saved_queries: [] };
}

function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings();
  const data = raw as Record<string, unknown>;
  const conns = Array.isArray(data.connections) ? data.connections : [];
  const connections: ConnectionProfile[] = conns
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => normalizeProfile(c as Partial<ConnectionProfile>));
  const favoriteKeyspaces =
    data.favorite_keyspaces && typeof data.favorite_keyspaces === 'object'
      ? (data.favorite_keyspaces as Record<string, string[]>)
      : {};
  const savedQueries: SavedQuery[] = Array.isArray(data.saved_queries)
    ? (data.saved_queries as SavedQuery[]).filter(
        (q) => q && typeof q.id === 'string' && typeof q.name === 'string' && typeof q.query === 'string',
      )
    : [];
  return {
    connections,
    last_connection_name: typeof data.last_connection_name === 'string' ? data.last_connection_name : '',
    favorite_keyspaces: favoriteKeyspaces,
    saved_queries: savedQueries,
  };
}

export class DocumentRepository implements ConfigRepository {
  constructor(readonly storage: ConfigStorage) {}

  get description(): string {
    return this.storage.description;
  }

  // --- documents ---------------------------------------------------------------------------

  private async load(): Promise<AppSettings> {
    await initConfigVersion(this.storage);
    let raw: unknown;
    try {
      raw = await this.storage.get(CONFIG_KEY);
    } catch (err) {
      console.warn('[kassandra] could not read config:', err);
      return defaultSettings();
    }
    if (raw === undefined) {
      const settings = defaultSettings();
      await this.save(settings);
      return settings;
    }
    return normalizeSettings(raw);
  }

  private async save(settings: AppSettings): Promise<void> {
    // Must run before the config is first written so fresh storage is told apart from a legacy one.
    await initConfigVersion(this.storage);
    await this.storage.put(CONFIG_KEY, settings);
  }

  // --- lifecycle ---------------------------------------------------------------------------

  migrate(): Promise<string[]> {
    return runMigrations(this.storage);
  }

  getVersion(): Promise<string | null> {
    return this.storage.getVersion();
  }

  async isEmpty(): Promise<boolean> {
    return (await this.storage.list('')).filter((k) => !k.startsWith('backups/')).length === 0;
  }

  async exportSnapshot(): Promise<ConfigSnapshot> {
    const settings = normalizeSettings(await this.storage.get(CONFIG_KEY));
    const tables: ConfigSnapshot['tables'] = [];
    for (const summary of await this.listTables()) {
      const { columns: _count, ...ref } = summary;
      tables.push({ ...ref, columns: await this.getTableMetadata(ref) });
    }
    return { version: await this.storage.getVersion(), settings, tables };
  }

  async importSnapshot(snapshot: ConfigSnapshot): Promise<void> {
    const { settings } = snapshot;
    const known = new Set(settings.connections.map((c) => c.name));
    await this.storage.put(CONFIG_KEY, {
      ...settings,
      last_connection_name: known.has(settings.last_connection_name) ? settings.last_connection_name : '',
      favorite_keyspaces: Object.fromEntries(Object.entries(settings.favorite_keyspaces).filter(([c]) => known.has(c))),
    });
    for (const { columns, ...ref } of snapshot.tables) {
      if (known.has(ref.connection)) await writeTableMetadata(this.storage, ref.connection, ref.keyspace, ref.table, columns);
    }
    if (snapshot.version) await this.storage.setVersion(snapshot.version);
  }

  lock(options?: LockOptions): Promise<() => Promise<void>> {
    return this.storage.lock(options);
  }

  close(): void {}

  // --- connection profiles -----------------------------------------------------------------

  async listProfiles(): Promise<ConnectionProfile[]> {
    return (await this.load()).connections;
  }

  async getProfile(name: string): Promise<ConnectionProfile | null> {
    return (await this.load()).connections.find((c) => c.name === name) ?? null;
  }

  async upsertProfile(profile: ConnectionProfile): Promise<ConnectionProfile> {
    const settings = await this.load();
    const idx = settings.connections.findIndex((c) => c.name === profile.name);
    if (idx === -1) settings.connections.push(profile);
    else settings.connections[idx] = profile;
    await this.save(settings);
    return profile;
  }

  async deleteProfile(name: string): Promise<void> {
    const settings = await this.load();
    settings.connections = settings.connections.filter((c) => c.name !== name);
    if (settings.last_connection_name === name) settings.last_connection_name = '';
    delete settings.favorite_keyspaces[name];
    await this.save(settings);
    await deleteConnectionTables(this.storage, name);
  }

  async getLastConnection(): Promise<string> {
    return (await this.load()).last_connection_name;
  }

  async setLastConnection(name: string): Promise<void> {
    const settings = await this.load();
    settings.last_connection_name = name;
    await this.save(settings);
  }

  // --- favorite keyspaces ------------------------------------------------------------------

  async getFavoriteKeyspaces(profile: string): Promise<string[]> {
    return (await this.load()).favorite_keyspaces[profile] ?? [];
  }

  async addFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]> {
    const settings = await this.load();
    const existing = settings.favorite_keyspaces[profile] ?? [];
    if (!existing.includes(keyspace)) {
      settings.favorite_keyspaces[profile] = [...existing, keyspace];
      await this.save(settings);
    }
    return settings.favorite_keyspaces[profile] ?? existing;
  }

  async removeFavoriteKeyspace(profile: string, keyspace: string): Promise<string[]> {
    const settings = await this.load();
    const filtered = (settings.favorite_keyspaces[profile] ?? []).filter((k) => k !== keyspace);
    settings.favorite_keyspaces[profile] = filtered;
    await this.save(settings);
    return filtered;
  }

  // --- saved queries -----------------------------------------------------------------------

  async listSavedQueries(): Promise<SavedQuery[]> {
    return (await this.load()).saved_queries;
  }

  async createSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
    const settings = await this.load();
    if (settings.saved_queries.some((q) => q.name === input.name)) {
      throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
    }
    const created: SavedQuery = { id: crypto.randomUUID(), ...input };
    settings.saved_queries.push(created);
    await this.save(settings);
    return created;
  }

  async updateSavedQuery(id: string, input: SavedQueryInput): Promise<SavedQuery> {
    const settings = await this.load();
    const idx = settings.saved_queries.findIndex((q) => q.id === id);
    if (idx === -1) throw new SavedQueryError('Saved query not found', 404);
    if (settings.saved_queries.some((q) => q.id !== id && q.name === input.name)) {
      throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
    }
    const updated: SavedQuery = { id, ...input };
    settings.saved_queries[idx] = updated;
    await this.save(settings);
    return updated;
  }

  async deleteSavedQuery(id: string): Promise<void> {
    const settings = await this.load();
    const filtered = settings.saved_queries.filter((q) => q.id !== id);
    if (filtered.length === settings.saved_queries.length) throw new SavedQueryError('Saved query not found', 404);
    settings.saved_queries = filtered;
    await this.save(settings);
  }

  async importSavedQueries(inputs: SavedQueryInput[]): Promise<{ created: number; updated: number }> {
    const settings = await this.load();
    let created = 0;
    let updated = 0;
    for (const input of inputs) {
      const idx = settings.saved_queries.findIndex((q) => q.name === input.name);
      if (idx === -1) {
        settings.saved_queries.push({ id: crypto.randomUUID(), ...input });
        created++;
      } else {
        settings.saved_queries[idx] = { id: settings.saved_queries[idx]!.id, ...input };
        updated++;
      }
    }
    await this.save(settings);
    return { created, updated };
  }

  // --- table metadata ----------------------------------------------------------------------

  getTableMetadata(ref: TableRef): Promise<TableColumns> {
    return readTableMetadata(this.storage, ref.connection, ref.keyspace, ref.table);
  }

  async setColumnMetadata(ref: TableRef, column: string, metadata: ColumnMetadata): Promise<ColumnMetadata> {
    const columns = await this.getTableMetadata(ref);
    const merged: ColumnMetadata = { ...(columns[column] ?? {}), ...metadata };
    columns[column] = merged;
    await writeTableMetadata(this.storage, ref.connection, ref.keyspace, ref.table, columns);
    return merged;
  }

  replaceTableMetadata(ref: TableRef, columns: TableColumns): Promise<void> {
    return writeTableMetadata(this.storage, ref.connection, ref.keyspace, ref.table, columns);
  }

  async listTables(): Promise<TableSummary[]> {
    return (await listTableFiles(this.storage)).map(({ connection, keyspace, table, columns }) => ({
      connection,
      keyspace,
      table,
      columns,
    }));
  }
}
