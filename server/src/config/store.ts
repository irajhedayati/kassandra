/**
 * The application's view of persisted settings (connection profiles,
 * favorites, saved queries) and per-table column metadata: every operation is
 * forwarded to the active ConfigRepository, one at a time (see serial.ts) so
 * read-modify-write backends cannot lose concurrent updates.
 *
 * Mirrors legacy/src/config/settings.py (ConfigManager).
 */
import type {
  ColumnMetadata,
  ConnectionProfile,
  SavedQuery,
  SavedQueryInput,
  TableMetadataFile,
} from '@kassandra/shared';
import { getRepository } from './registry.js';
import { SavedQueryError, type TableColumns, type TableRef } from './repository.js';
import { serialize } from './serial.js';
import { tableFileName } from './tables.js';

export { SavedQueryError };

export function listProfiles(): Promise<ConnectionProfile[]> {
  return serialize(() => getRepository().listProfiles());
}

export function getProfile(name: string): Promise<ConnectionProfile | null> {
  return serialize(() => getRepository().getProfile(name));
}

export function upsertProfile(profile: ConnectionProfile): Promise<ConnectionProfile> {
  return serialize(() => getRepository().upsertProfile(profile));
}

export function deleteProfile(name: string): Promise<void> {
  return serialize(() => getRepository().deleteProfile(name));
}

export function getLastConnection(): Promise<string> {
  return serialize(() => getRepository().getLastConnection());
}

export function setLastConnection(name: string): Promise<void> {
  return serialize(() => getRepository().setLastConnection(name));
}

export function getTableMetadata(connection: string, keyspace: string, table: string): Promise<TableColumns> {
  return serialize(() => getRepository().getTableMetadata({ connection, keyspace, table }));
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
  return serialize(() => getRepository().setColumnMetadata({ connection, keyspace, table }, column, metadata));
}

/** Every table that has metadata, as the entries of the "import from" list, sorted by name. */
export function listTableFiles(): Promise<TableMetadataFile[]> {
  return serialize(async () =>
    (await getRepository().listTables())
      .map((t) => ({ file: tableFileName(t.connection, t.keyspace, t.table), ...t }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
  );
}

/** Run `fn` against the active repository as one uninterrupted step. */
export function withRepository<T>(fn: (repository: ReturnType<typeof getRepository>) => Promise<T>): Promise<T> {
  return serialize(() => fn(getRepository()));
}

export function getFavoriteKeyspaces(profileName: string): Promise<string[]> {
  return serialize(() => getRepository().getFavoriteKeyspaces(profileName));
}

export function addFavoriteKeyspace(profileName: string, keyspace: string): Promise<string[]> {
  return serialize(() => getRepository().addFavoriteKeyspace(profileName, keyspace));
}

export function removeFavoriteKeyspace(profileName: string, keyspace: string): Promise<string[]> {
  return serialize(() => getRepository().removeFavoriteKeyspace(profileName, keyspace));
}

export function listSavedQueries(): Promise<SavedQuery[]> {
  return serialize(() => getRepository().listSavedQueries());
}

export function createSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
  return serialize(() => getRepository().createSavedQuery(input));
}

export function updateSavedQuery(id: string, input: SavedQueryInput): Promise<SavedQuery> {
  return serialize(() => getRepository().updateSavedQuery(id, input));
}

export function deleteSavedQuery(id: string): Promise<void> {
  return serialize(() => getRepository().deleteSavedQuery(id));
}

/** Upsert by name: existing queries with the same name are overwritten. */
export function importSavedQueries(inputs: SavedQueryInput[]): Promise<{ created: number; updated: number }> {
  return serialize(() => getRepository().importSavedQueries(inputs));
}

export type { TableRef };
