/**
 * Per-session registry of active Cassandra connections. Each browser tab
 * sends its own session id (`X-Kassandra-Session`), so tabs and windows can
 * be connected to different clusters at the same time. The connection lane
 * (POST /api/profiles/connect) sets a session's connection; the schema, data,
 * cql, and metadata lanes read it.
 *
 * The session id for the current request is carried in an AsyncLocalStorage
 * (see `sessionMiddleware`), so `getActive()` / `requireSession()` keep their
 * no-argument form.
 *
 * All non-connection routes should call `requireSession()` and bail with a
 * 409 if it returns null.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { Client as CassandraClient } from 'cassandra-driver';
import type { ConnectionProfile } from '@kassandra/shared';

export const SESSION_HEADER = 'x-kassandra-session';
/** Used for requests without the header (curl, scripts), which then share one connection. */
const DEFAULT_SESSION = 'default';
const MAX_SESSION_ID_LENGTH = 100;

/** Connections unused for this long are shut down (abandoned tabs can't disconnect themselves). */
const IDLE_TIMEOUT_MS = Number(process.env.KASSANDRA_SESSION_IDLE_MINUTES ?? 120) * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

interface ActiveConnection {
  client: CassandraClient;
  profile: ConnectionProfile;
  keyspace: string | null;
}

interface Entry {
  conn: ActiveConnection;
  lastUsed: number;
}

const sessions = new Map<string, Entry>();
const context = new AsyncLocalStorage<string>();
let sweeper: NodeJS.Timeout | null = null;

function currentSessionId(): string {
  return context.getStore() ?? DEFAULT_SESSION;
}

/** Express middleware: run the rest of the request under the caller's session id. */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get(SESSION_HEADER)?.trim();
  const id = header && header.length <= MAX_SESSION_ID_LENGTH ? header : DEFAULT_SESSION;
  context.run(id, next);
}

/** Run `fn` as the given session (tests, background work). */
export function runWithSession<T>(sessionId: string, fn: () => T): T {
  return context.run(sessionId, fn);
}

export function setActive(conn: ActiveConnection): void {
  sessions.set(currentSessionId(), { conn, lastUsed: Date.now() });
  startSweeper();
}

export function clearActive(): void {
  sessions.delete(currentSessionId());
}

export function getActive(): ActiveConnection | null {
  const entry = sessions.get(currentSessionId());
  if (!entry) return null;
  entry.lastUsed = Date.now();
  return entry.conn;
}

/**
 * Helper for non-connection routes. Returns the active connection or throws
 * a tagged error that the error middleware turns into a 409.
 */
export function requireSession(): ActiveConnection {
  const active = getActive();
  if (!active) {
    const err = new Error('Not connected. Connect to a Cassandra cluster first.');
    (err as { status?: number }).status = 409;
    throw err;
  }
  return active;
}

/** Shut down and drop every connection idle for longer than `maxIdleMs`. Returns how many. */
export async function closeIdleSessions(maxIdleMs: number = IDLE_TIMEOUT_MS, now = Date.now()): Promise<number> {
  const stale = [...sessions].filter(([, e]) => now - e.lastUsed > maxIdleMs);
  for (const [id, entry] of stale) {
    sessions.delete(id);
    try {
      await entry.conn.client.shutdown();
    } catch (err) {
      console.warn('[kassandra] error shutting down idle session:', err);
    }
  }
  return stale.length;
}

/** Shut down every connection (process exit). */
export async function closeAllSessions(): Promise<void> {
  await closeIdleSessions(-1);
}

function startSweeper(): void {
  if (sweeper || !(IDLE_TIMEOUT_MS > 0)) return;
  sweeper = setInterval(() => void closeIdleSessions(), SWEEP_INTERVAL_MS);
  sweeper.unref();
}
