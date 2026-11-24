/**
 * 1.6.0 -> 1.7.0: connection profiles get `read_only`.
 *
 * Adds `read_only: false` to every profile in config.json that has no
 * `read_only` yet, so existing profiles stay writable. A value that is already
 * there is kept (a profile saved by a newer build, or edited by hand), and so is
 * everything else in the document.
 */
import type { Migration } from './index.js';

export const migration: Migration = {
  version: '1.7.0',
  description: 'Add read_only (false) to connection profiles',
  async up({ storage }) {
    const config = await storage.get('config');
    if (!config || typeof config !== 'object') return;
    const document = config as Record<string, unknown>;
    if (!Array.isArray(document.connections)) return;

    let changed = false;
    document.connections = document.connections.map((connection: unknown) => {
      if (!connection || typeof connection !== 'object' || 'read_only' in connection) return connection;
      changed = true;
      return { ...(connection as Record<string, unknown>), read_only: false };
    });
    if (changed) await storage.put('config', document);
  },
};
