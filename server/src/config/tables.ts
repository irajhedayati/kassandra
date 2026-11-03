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
import type { ColumnMetadata } from '@kassandra/shared';

export const TABLES_DIR_NAME = 'tables';

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
