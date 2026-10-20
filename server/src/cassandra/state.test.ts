import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'cassandra-driver';
import type { ConnectionProfile } from '@kassandra/shared';
import {
  clearActive,
  closeAllSessions,
  closeIdleSessions,
  getActive,
  requireSession,
  runWithSession,
  SESSION_HEADER,
  sessionMiddleware,
  setActive,
} from './state.js';

const fakeConn = (name: string) => {
  const shutdown = vi.fn().mockResolvedValue(undefined);
  return {
    shutdown,
    conn: {
      client: { shutdown } as unknown as Client,
      profile: { name } as ConnectionProfile,
      keyspace: null,
    },
  };
};

afterEach(() => closeAllSessions());

describe('per-session connections', () => {
  it('keeps a separate connection for each session', () => {
    const a = fakeConn('cluster-a');
    const b = fakeConn('cluster-b');
    runWithSession('tab-a', () => setActive(a.conn));
    runWithSession('tab-b', () => setActive(b.conn));

    expect(runWithSession('tab-a', () => requireSession().profile.name)).toBe('cluster-a');
    expect(runWithSession('tab-b', () => requireSession().profile.name)).toBe('cluster-b');
  });

  it('only disconnects the calling session', () => {
    runWithSession('tab-a', () => setActive(fakeConn('a').conn));
    runWithSession('tab-b', () => setActive(fakeConn('b').conn));
    runWithSession('tab-a', () => clearActive());

    expect(runWithSession('tab-a', () => getActive())).toBeNull();
    expect(runWithSession('tab-b', () => getActive())).not.toBeNull();
  });

  it('answers 409 for a session that never connected', () => {
    expect(() => runWithSession('nobody', () => requireSession())).toThrow(/Not connected/);
  });

  it('shuts down idle sessions only', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const idle = fakeConn('idle');
      const busy = fakeConn('busy');
      runWithSession('idle', () => setActive(idle.conn));
      runWithSession('busy', () => setActive(busy.conn));

      vi.setSystemTime(1_010_000);
      runWithSession('busy', () => getActive()); // touching refreshes lastUsed

      expect(await closeIdleSessions(5_000)).toBe(1);
      expect(idle.shutdown).toHaveBeenCalledOnce();
      expect(busy.shutdown).not.toHaveBeenCalled();
      expect(runWithSession('idle', () => getActive())).toBeNull();
      expect(runWithSession('busy', () => getActive())).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sessionMiddleware', () => {
  const run = (header: string | undefined, check: () => Promise<void> | void) =>
    new Promise<void>((resolve, reject) => {
      const req = { get: (n: string) => (n.toLowerCase() === SESSION_HEADER ? header : undefined) };
      sessionMiddleware(req as never, {} as never, () => {
        Promise.resolve(check()).then(resolve, reject);
      });
    });

  it("resolves the caller's connection from the session header, across awaits", async () => {
    runWithSession('tab-1', () => setActive(fakeConn('cluster-1').conn));
    runWithSession('tab-2', () => setActive(fakeConn('cluster-2').conn));

    await run('tab-1', async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(getActive()?.profile.name).toBe('cluster-1');
    });
    await run('tab-2', () => expect(getActive()?.profile.name).toBe('cluster-2'));
  });

  it('treats a missing or oversized header as the shared default session', async () => {
    runWithSession('default', () => setActive(fakeConn('shared').conn));
    await run(undefined, () => expect(getActive()?.profile.name).toBe('shared'));
    await run('x'.repeat(500), () => expect(getActive()?.profile.name).toBe('shared'));
    await run('tab-unknown', () => expect(getActive()).toBeNull());
  });
});
