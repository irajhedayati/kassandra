/**
 * Process-wide singleton holding the active Cassandra session and the current
 * profile. The connection lane (POST /api/profiles/connect) sets these; the
 * schema, data, cql, and metadata lanes read from them.
 *
 * All non-connection routes should call `requireSession()` and bail with a
 * 409 if it returns null.
 */
import type { Client as CassandraClient } from 'cassandra-driver';
import type { ConnectionProfile } from '@py-sandra/shared';

interface ActiveConnection {
  client: CassandraClient;
  profile: ConnectionProfile;
  keyspace: string | null;
}

let active: ActiveConnection | null = null;

export function setActive(conn: ActiveConnection): void {
  active = conn;
}

export function clearActive(): void {
  active = null;
}

export function getActive(): ActiveConnection | null {
  return active;
}

/**
 * Helper for non-connection routes. Returns the active connection or throws
 * a tagged error that the error middleware turns into a 409.
 */
export function requireSession(): ActiveConnection {
  if (!active) {
    const err = new Error('Not connected. Connect to a Cassandra cluster first.');
    (err as { status?: number }).status = 409;
    throw err;
  }
  return active;
}
