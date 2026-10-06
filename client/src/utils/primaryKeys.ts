import type { Row, TableSchema } from '@kassandra/shared';

/** Pick the primary-key column values out of a stored row. */
export function primaryKeysOf(schema: TableSchema, row: Row | undefined): Row {
  const keys: Row = {};
  if (!row) return keys;
  for (const col of schema.columns) {
    if (col.kind === 'partition_key' || col.kind === 'clustering') {
      keys[col.name] = row[col.name] ?? null;
    }
  }
  return keys;
}
