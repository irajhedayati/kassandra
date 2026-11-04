/**
 * Persistence for AppSettings (connection profiles, favorites, saved queries)
 * and per-table column metadata, on top of the active ConfigStorage.
 *
 * Mirrors legacy/src/config/settings.py (ConfigManager). Every function is a
 * read-modify-write on tiny documents, so they all run one at a time (see
 * serial.ts) to keep concurrent requests from overwriting each other.
 */
import crypto from 'node:crypto';
import type {
  AppSettings,
  ColumnMetadata,
  ConnectionProfile,
  SavedQuery,
  SavedQueryInput,
} from '@kassandra/shared';
import { DEFAULT_PROFILE } from '@kassandra/shared';
import { serialize } from './serial.js';
import { getStorage } from './storage.js';
import {
  deleteConnectionTables,
  readTableMetadata,
  writeTableMetadata,
} from './tables.js';
import { initConfigVersion } from './version.js';

const CONFIG_KEY = 'config';

function defaultSettings(): AppSettings {
  return {
    connections: [],
    last_connection_name: '',
    favorite_keyspaces: {},
    saved_queries: [],
  };
}

/**
 * Coerce a partial profile from disk into a full ConnectionProfile by
 * filling in defaults for any missing fields.
 */
function normalizeProfile(p: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    ...DEFAULT_PROFILE,
    ...p,
    name: p.name ?? '',
    hosts: Array.isArray(p.hosts) && p.hosts.length > 0 ? p.hosts : ['127.0.0.1'],
  };
}

function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings();
  const data = raw as Record<string, unknown>;
  const conns = Array.isArray(data.connections) ? data.connections : [];
  const connections: ConnectionProfile[] = conns
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => normalizeProfile(c as Partial<ConnectionProfile>));
  const last =
    typeof data.last_connection_name === 'string' ? data.last_connection_name : '';
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
    last_connection_name: last,
    favorite_keyspaces: favoriteKeyspaces,
    saved_queries: savedQueries,
  };
}

async function load(): Promise<AppSettings> {
  const storage = getStorage();
  await initConfigVersion(storage);
  let raw: unknown;
  try {
    raw = await storage.get(CONFIG_KEY);
  } catch (err) {
    console.warn('[kassandra] could not read config:', err);
    return defaultSettings();
  }
  if (raw === undefined) {
    const settings = defaultSettings();
    await save(settings);
    return settings;
  }
  return normalizeSettings(raw);
}

async function save(settings: AppSettings): Promise<void> {
  const storage = getStorage();
  // Must run before the config is first written so fresh storage is told apart from a legacy one.
  await initConfigVersion(storage);
  await storage.put(CONFIG_KEY, settings);
}

export function loadSettings(): Promise<AppSettings> {
  return serialize(load);
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return serialize(() => save(settings));
}

export function listProfiles(): Promise<ConnectionProfile[]> {
  return serialize(async () => (await load()).connections);
}

export function getProfile(name: string): Promise<ConnectionProfile | null> {
  return serialize(async () => (await load()).connections.find((c) => c.name === name) ?? null);
}

export function upsertProfile(profile: ConnectionProfile): Promise<ConnectionProfile> {
  return serialize(async () => {
    const settings = await load();
    settings.connections = [...settings.connections.filter((c) => c.name !== profile.name), profile];
    await save(settings);
    return profile;
  });
}

export function deleteProfile(name: string): Promise<void> {
  return serialize(async () => {
    const settings = await load();
    settings.connections = settings.connections.filter((c) => c.name !== name);
    if (settings.last_connection_name === name) {
      settings.last_connection_name = '';
    }
    await save(settings);
    await deleteConnectionTables(getStorage(), name);
  });
}

export function setLastConnection(name: string): Promise<void> {
  return serialize(async () => {
    const settings = await load();
    settings.last_connection_name = name;
    await save(settings);
  });
}

export function getTableMetadata(
  connection: string,
  keyspace: string,
  table: string,
): Promise<Record<string, ColumnMetadata>> {
  return serialize(() => readTableMetadata(getStorage(), connection, keyspace, table));
}

export async function getColumnMetadata(
  connection: string,
  keyspace: string,
  table: string,
  column: string,
): Promise<ColumnMetadata> {
  return (await getTableMetadata(connection, keyspace, table))[column] ?? {};
}

export function setColumnMetadata(
  connection: string,
  keyspace: string,
  table: string,
  column: string,
  metadata: ColumnMetadata,
): Promise<ColumnMetadata> {
  return serialize(async () => {
    const storage = getStorage();
    const tableMeta = await readTableMetadata(storage, connection, keyspace, table);
    const merged: ColumnMetadata = { ...(tableMeta[column] ?? {}), ...metadata };
    tableMeta[column] = merged;
    await writeTableMetadata(storage, connection, keyspace, table, tableMeta);
    return merged;
  });
}

export function getFavoriteKeyspaces(profileName: string): Promise<string[]> {
  return serialize(async () => (await load()).favorite_keyspaces[profileName] ?? []);
}

export function addFavoriteKeyspace(profileName: string, keyspace: string): Promise<string[]> {
  return serialize(async () => {
    const settings = await load();
    const existing = settings.favorite_keyspaces[profileName] ?? [];
    if (!existing.includes(keyspace)) {
      settings.favorite_keyspaces[profileName] = [...existing, keyspace];
      await save(settings);
    }
    return settings.favorite_keyspaces[profileName] ?? existing;
  });
}

export function removeFavoriteKeyspace(profileName: string, keyspace: string): Promise<string[]> {
  return serialize(async () => {
    const settings = await load();
    const filtered = (settings.favorite_keyspaces[profileName] ?? []).filter((k) => k !== keyspace);
    settings.favorite_keyspaces[profileName] = filtered;
    await save(settings);
    return filtered;
  });
}

export class SavedQueryError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function listSavedQueries(): Promise<SavedQuery[]> {
  return serialize(async () => (await load()).saved_queries);
}

export function createSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
  return serialize(async () => {
    const settings = await load();
    if (settings.saved_queries.some((q) => q.name === input.name)) {
      throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
    }
    const created: SavedQuery = { id: crypto.randomUUID(), ...input };
    settings.saved_queries.push(created);
    await save(settings);
    return created;
  });
}

export function updateSavedQuery(id: string, input: SavedQueryInput): Promise<SavedQuery> {
  return serialize(async () => {
    const settings = await load();
    const idx = settings.saved_queries.findIndex((q) => q.id === id);
    if (idx === -1) throw new SavedQueryError('Saved query not found', 404);
    if (settings.saved_queries.some((q) => q.id !== id && q.name === input.name)) {
      throw new SavedQueryError(`A saved query named "${input.name}" already exists`, 409);
    }
    const updated: SavedQuery = { id, ...input };
    settings.saved_queries[idx] = updated;
    await save(settings);
    return updated;
  });
}

export function deleteSavedQuery(id: string): Promise<void> {
  return serialize(async () => {
    const settings = await load();
    const filtered = settings.saved_queries.filter((q) => q.id !== id);
    if (filtered.length === settings.saved_queries.length) {
      throw new SavedQueryError('Saved query not found', 404);
    }
    settings.saved_queries = filtered;
    await save(settings);
  });
}

/** Upsert by name: existing queries with the same name are overwritten. */
export function importSavedQueries(
  inputs: SavedQueryInput[],
): Promise<{ created: number; updated: number }> {
  return serialize(async () => {
    const settings = await load();
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
    await save(settings);
    return { created, updated };
  });
}
