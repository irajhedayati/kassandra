/**
 * Per-table column metadata, one file per connection + table:
 *
 *   {config dir}/tables/{connection}-{keyspace}.{table}.json
 *
 * Each part is percent-encoded down to [A-Za-z0-9_], so `-` and `.` only ever
 * appear as separators and the name maps back to its parts unambiguously.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ColumnMetadata, TableMetadataFile } from '@kassandra/shared';

export const TABLES_DIR_NAME = 'tables';

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

/** Shape of a whole per-table file: column name -> metadata. */
export const tableMetadataSchema = z.record(z.string(), columnMetadataSchema);

function encodePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/gu, (c) =>
    [...Buffer.from(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''),
  );
}

function tablesDir(configDir: string): string {
  return path.join(configDir, TABLES_DIR_NAME);
}

export function tableMetadataFile(
  configDir: string,
  connection: string,
  keyspace: string,
  table: string,
): string {
  const name = `${encodePart(connection)}-${encodePart(keyspace)}.${encodePart(table)}.json`;
  return path.join(tablesDir(configDir), name);
}

export function readTableMetadata(
  configDir: string,
  connection: string,
  keyspace: string,
  table: string,
): Record<string, ColumnMetadata> {
  const file = tableMetadataFile(configDir, connection, keyspace, table);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, ColumnMetadata>)
      : {};
  } catch (err) {
    console.warn(`[kassandra] could not parse table metadata ${file}:`, err);
    return {};
  }
}

export function writeTableMetadata(
  configDir: string,
  connection: string,
  keyspace: string,
  table: string,
  metadata: Record<string, ColumnMetadata>,
): void {
  fs.mkdirSync(tablesDir(configDir), { recursive: true });
  const file = tableMetadataFile(configDir, connection, keyspace, table);
  fs.writeFileSync(file, JSON.stringify(metadata, null, 2), 'utf-8');
}

export function tableMetadataExists(
  configDir: string,
  connection: string,
  keyspace: string,
  table: string,
): boolean {
  return fs.existsSync(tableMetadataFile(configDir, connection, keyspace, table));
}

/** Remove every table file belonging to `connection`. */
export function deleteConnectionTables(configDir: string, connection: string): void {
  const dir = tablesDir(configDir);
  if (!fs.existsSync(dir)) return;
  const prefix = `${encodePart(connection)}-`;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(prefix) && name.endsWith('.json')) fs.rmSync(path.join(dir, name));
  }
}

function decodePart(value: string): string {
  return decodeURIComponent(value);
}

/** Inverse of tableMetadataFile's naming; null if `name` is not a per-table metadata file name. */
export function parseTableFileName(
  name: string,
): { connection: string; keyspace: string; table: string } | null {
  const match = /^([A-Za-z0-9_%]+)-([A-Za-z0-9_%]+)\.([A-Za-z0-9_%]+)\.json$/.exec(name);
  if (!match) return null;
  try {
    return {
      connection: decodePart(match[1]!),
      keyspace: decodePart(match[2]!),
      table: decodePart(match[3]!),
    };
  } catch {
    return null;
  }
}

/** Every per-table metadata file in the config directory, sorted by name. */
export function listTableFiles(configDir: string): TableMetadataFile[] {
  const dir = tablesDir(configDir);
  if (!fs.existsSync(dir)) return [];
  const files: TableMetadataFile[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const parts = parseTableFileName(file);
    if (!parts) continue;
    let columns = 0;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as unknown;
      if (parsed && typeof parsed === 'object') columns = Object.keys(parsed).length;
    } catch {
      // unreadable files are still listed; importing them reports the problem
    }
    files.push({ file, ...parts, columns });
  }
  return files;
}

/** Absolute path of a listed file; rejects anything that is not a plain per-table file name. */
export function tableFilePath(configDir: string, file: string): string {
  if (file !== path.basename(file) || parseTableFileName(file) === null) {
    throw new TableFileError(`Not a table metadata file: ${file}`, 400);
  }
  return path.join(tablesDir(configDir), file);
}

export class TableFileError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}
