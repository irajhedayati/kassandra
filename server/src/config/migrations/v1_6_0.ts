/**
 * 1.5.0 -> 1.6.0: column metadata moves out of config.json.
 *
 * Before: config.json held `table_metadata`, keyed `keyspace.table` and shared
 * by every connection. After: one file per connection and table under tables/
 * (see config/tables.ts). Since the old data did not record which connection it
 * belonged to, it is copied to every connection in config.json; files that
 * already exist are kept.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ColumnMetadata } from '@kassandra/shared';
import { tableMetadataExists, writeTableMetadata } from '../tables.js';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: '1.6.0',
  description: 'Split table_metadata out of config.json into per-table files',
  up({ dir }) {
    const file = path.join(dir, 'config.json');
    if (!fs.existsSync(file)) return;
    const config = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    if (!('table_metadata' in config)) return;

    const legacy = config.table_metadata;
    const connections = (Array.isArray(config.connections) ? config.connections : [])
      .map((c) => (c as { name?: unknown } | null)?.name)
      .filter((name): name is string => typeof name === 'string' && name !== '');

    if (legacy && typeof legacy === 'object') {
      const entries = Object.entries(legacy as Record<string, Record<string, ColumnMetadata>>);
      if (entries.length > 0 && connections.length === 0) {
        console.warn(
          '[kassandra] table metadata was not migrated because there are no connections; ' +
            'it is kept in the backup created before migrating (backups/1.5.0/)',
        );
      }
      for (const [key, columns] of entries) {
        const dot = key.indexOf('.');
        if (dot === -1) continue;
        const keyspace = key.slice(0, dot);
        const table = key.slice(dot + 1);
        for (const connection of connections) {
          if (!tableMetadataExists(dir, connection, keyspace, table)) {
            writeTableMetadata(dir, connection, keyspace, table, columns);
          }
        }
      }
    }

    delete config.table_metadata;
    fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8');
  },
};
