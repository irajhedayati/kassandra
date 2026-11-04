/**
 * Per-table column metadata, one document per connection + table:
 *
 *   key  tables/{connection}-{keyspace}.{table}
 *   (file storage: {config dir}/tables/{connection}-{keyspace}.{table}.json)
 *
 * Each part is percent-encoded down to [A-Za-z0-9_], so `-` and `.` only ever
 * appear as separators and the name maps back to its parts unambiguously.
 */
import { z } from 'zod';
import type { ColumnMetadata, TableMetadataFile } from '@kassandra/shared';
import type { ConfigStorage } from './storage.js';

export const TABLES_PREFIX = 'tables/';

const mapSchemaEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  display_type: z.string().optional(),
  enum_values: z.array(z.string()).optional(),
});

export const columnMetadataSchema = z
  .object({
    hide: z.boolean().optional(),
    display_type: z.string().optional(),
    map_schema: z.array(mapSchemaEntrySchema).optional(),
    enum_values: z.array(z.string()).optional(),
  })
  .strict();

/** Shape of a whole per-table document: column name -> metadata. */
export const tableMetadataSchema = z.record(z.string(), columnMetadataSchema);

export class TableFileError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

function encodePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/gu, (c) =>
    [...Buffer.from(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''),
  );
}

/** Name of the file for a table, e.g. `prod-ks.users.json`. */
export function tableFileName(connection: string, keyspace: string, table: string): string {
  return `${encodePart(connection)}-${encodePart(keyspace)}.${encodePart(table)}.json`;
}

/** Storage key for a file name as returned by tableFileName / listTableFiles. */
export function tableKeyForFile(file: string): string {
  if (parseTableFileName(file) === null) throw new TableFileError(`Not a table metadata file: ${file}`, 400);
  return `${TABLES_PREFIX}${file.slice(0, -'.json'.length)}`;
}

function tableKey(connection: string, keyspace: string, table: string): string {
  return tableKeyForFile(tableFileName(connection, keyspace, table));
}

/** Inverse of tableFileName; null if `name` is not a per-table metadata file name. */
export function parseTableFileName(
  name: string,
): { connection: string; keyspace: string; table: string } | null {
  const match = /^([A-Za-z0-9_%]+)-([A-Za-z0-9_%]+)\.([A-Za-z0-9_%]+)\.json$/.exec(name);
  if (!match) return null;
  try {
    return {
      connection: decodeURIComponent(match[1]!),
      keyspace: decodeURIComponent(match[2]!),
      table: decodeURIComponent(match[3]!),
    };
  } catch {
    return null;
  }
}

export async function readTableMetadata(
  storage: ConfigStorage,
  connection: string,
  keyspace: string,
  table: string,
): Promise<Record<string, ColumnMetadata>> {
  const key = tableKey(connection, keyspace, table);
  try {
    const parsed = await storage.get(key);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, ColumnMetadata>)
      : {};
  } catch (err) {
    console.warn(`[kassandra] could not read table metadata ${key}:`, err);
    return {};
  }
}

export function writeTableMetadata(
  storage: ConfigStorage,
  connection: string,
  keyspace: string,
  table: string,
  metadata: Record<string, ColumnMetadata>,
): Promise<void> {
  return storage.put(tableKey(connection, keyspace, table), metadata);
}

export async function tableMetadataExists(
  storage: ConfigStorage,
  connection: string,
  keyspace: string,
  table: string,
): Promise<boolean> {
  return (await storage.list(tableKey(connection, keyspace, table))).includes(
    tableKey(connection, keyspace, table),
  );
}

/** Remove every table document belonging to `connection`. */
export async function deleteConnectionTables(storage: ConfigStorage, connection: string): Promise<void> {
  const prefix = `${TABLES_PREFIX}${encodePart(connection)}-`;
  for (const key of await storage.list(prefix)) await storage.delete(key);
}

/** Every per-table metadata document, sorted by name. */
export async function listTableFiles(storage: ConfigStorage): Promise<TableMetadataFile[]> {
  const files: TableMetadataFile[] = [];
  for (const key of await storage.list(TABLES_PREFIX)) {
    const file = `${key.slice(TABLES_PREFIX.length)}.json`;
    const parts = parseTableFileName(file);
    if (!parts) continue;
    let columns = 0;
    try {
      const parsed = await storage.get(key);
      if (parsed && typeof parsed === 'object') columns = Object.keys(parsed).length;
    } catch {
      // unreadable documents are still listed; importing them reports the problem
    }
    files.push({ file, ...parts, columns });
  }
  return files;
}
