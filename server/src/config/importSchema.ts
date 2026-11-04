/**
 * Import a per-table metadata document from the config storage as the
 * metadata of another table (typically the same table of another connection).
 */
import type { ColumnMetadata } from '@kassandra/shared';
import type { ConfigStorage } from './storage.js';
import {
  readTableMetadata,
  TableFileError,
  tableKeyForFile,
  tableMetadataSchema,
  writeTableMetadata,
} from './tables.js';

export interface ImportTarget {
  connection: string;
  keyspace: string;
  table: string;
  /** Column names the target table actually has. */
  columns: string[];
}

/**
 * Validates `file` (JSON shape, and every column must exist on the target) and
 * writes it as the target's metadata, replacing what was there. Rejects with
 * TableFileError: 400 invalid file, 404 missing file, 409 target already has
 * metadata and `overwrite` is not set.
 */
export async function importTableMetadata(
  storage: ConfigStorage,
  file: string,
  target: ImportTarget,
  overwrite: boolean,
): Promise<Record<string, ColumnMetadata>> {
  const key = tableKeyForFile(file);
  if (!(await storage.list(key)).includes(key)) throw new TableFileError(`File not found: ${file}`, 404);

  let json: unknown;
  try {
    json = await storage.get(key);
  } catch (err) {
    throw new TableFileError(
      `${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      400,
    );
  }

  const parsed = tableMetadataSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new TableFileError(`${file} is not valid table metadata: ${issues}`, 400);
  }

  const known = new Set(target.columns);
  const unknown = Object.keys(parsed.data).filter((c) => !known.has(c));
  if (unknown.length > 0) {
    throw new TableFileError(
      `${file} has columns that do not exist in ${target.keyspace}.${target.table}: ${unknown.join(', ')}`,
      400,
    );
  }

  const existing = await readTableMetadata(storage, target.connection, target.keyspace, target.table);
  if (!overwrite && Object.keys(existing).length > 0) {
    throw new TableFileError(
      `Metadata for ${target.keyspace}.${target.table} already exists; confirm to overwrite it`,
      409,
    );
  }

  await writeTableMetadata(storage, target.connection, target.keyspace, target.table, parsed.data);
  return parsed.data;
}
