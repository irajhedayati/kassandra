/**
 * Import the column metadata of one table as the metadata of another (typically
 * the same table of another connection).
 */
import type { ColumnMetadata } from '@kassandra/shared';
import type { ConfigRepository, TableRef } from './repository.js';
import { parseTableFileName, TableFileError, tableMetadataSchema } from './tables.js';

export interface ImportTarget {
  connection: string;
  keyspace: string;
  table: string;
  /** Column names the target table actually has. */
  columns: string[];
}

/**
 * Validates the source named by `file` (a name from the table listing, see
 * tableFileName; every column must exist on the target) and stores its metadata
 * as the target's, replacing what was there. Rejects with TableFileError: 400
 * invalid name or metadata, 404 no such source, 409 target already has metadata
 * and `overwrite` is not set.
 */
export async function importTableMetadata(
  repository: ConfigRepository,
  file: string,
  target: ImportTarget,
  overwrite: boolean,
): Promise<Record<string, ColumnMetadata>> {
  const source: TableRef | null = parseTableFileName(file);
  if (!source) throw new TableFileError(`Not a table metadata file: ${file}`, 400);
  const listed = await repository.listTables();
  if (!listed.some((t) => t.connection === source.connection && t.keyspace === source.keyspace && t.table === source.table)) {
    throw new TableFileError(`File not found: ${file}`, 404);
  }

  const parsed = tableMetadataSchema.safeParse(await repository.getTableMetadata(source));
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

  const existing = await repository.getTableMetadata(target);
  if (!overwrite && Object.keys(existing).length > 0) {
    throw new TableFileError(
      `Metadata for ${target.keyspace}.${target.table} already exists; confirm to overwrite it`,
      409,
    );
  }

  await repository.replaceTableMetadata(target, parsed.data);
  return parsed.data;
}
