import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryHistoryEntry } from '@kassandra/shared';
import {
  compareHistory,
  decodeCursor,
  DEFAULT_HISTORY_LIMIT,
  encodeCursor,
  historyKey,
  historyLimit,
  historyPageSize,
  likePattern,
  newHistoryEntry,
} from './history.js';

const entry = (id: string, started_at: string): QueryHistoryEntry => ({
  id,
  profile: 'p',
  query: 'SELECT 1',
  params: [],
  started_at,
  duration_ms: 1,
  statements: 1,
  outcome: 'success',
  error: null,
});

describe('historyLimit', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults to 200', () => {
    vi.stubEnv('KASSANDRA_HISTORY_LIMIT', undefined);
    expect(historyLimit()).toBe(DEFAULT_HISTORY_LIMIT);
    expect(DEFAULT_HISTORY_LIMIT).toBe(200);
  });

  it('reads KASSANDRA_HISTORY_LIMIT', () => {
    vi.stubEnv('KASSANDRA_HISTORY_LIMIT', ' 25 ');
    expect(historyLimit()).toBe(25);
  });

  it('ignores a value that is not a positive integer, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of ['0', '-3', '2.5', 'lots']) {
      vi.stubEnv('KASSANDRA_HISTORY_LIMIT', value);
      expect(historyLimit(), value).toBe(DEFAULT_HISTORY_LIMIT);
    }
    expect(warn).toHaveBeenCalled();
  });
});

describe('historyPageSize', () => {
  it('defaults to 50 and stays within 1..500', () => {
    expect(historyPageSize(undefined)).toBe(50);
    expect(historyPageSize(Number.NaN)).toBe(50);
    expect(historyPageSize(0)).toBe(1);
    expect(historyPageSize(7.9)).toBe(7);
    expect(historyPageSize(10_000)).toBe(500);
  });
});

describe('newHistoryEntry', () => {
  it('assigns an id, normalizes started_at to UTC and defaults the error', () => {
    const e = newHistoryEntry({
      profile: 'p',
      query: 'q',
      params: [{ name: 'a', type: 'int', value: '1' }],
      started_at: '2026-05-06T07:08:09+02:00',
      duration_ms: 3,
      statements: 1,
      outcome: 'success',
      error: undefined as unknown as null,
    });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.started_at).toBe('2026-05-06T05:08:09.000Z');
    expect(e.error).toBeNull();
  });

  it('rejects a start time that cannot be parsed', () => {
    expect(() => newHistoryEntry({ ...entry('x', 'never'), id: undefined } as never)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('order and cursor', () => {
  it('sorts newest first, ties by descending id', () => {
    const entries = [
      entry('a', '2026-01-01T00:00:00.000Z'),
      entry('c', '2026-01-02T00:00:00.000Z'),
      entry('b', '2026-01-01T00:00:00.000Z'),
    ];
    expect(entries.sort(compareHistory).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('round-trips a cursor and rejects anything else', () => {
    const e = entry('id-1', '2026-01-01T00:00:00.123Z');
    expect(decodeCursor(encodeCursor(e))).toEqual({ startedAt: Date.parse(e.started_at), id: 'id-1' });
    for (const bad of ['', '!!!', Buffer.from('[1]').toString('base64url'), Buffer.from('["x","y"]').toString('base64url')]) {
      expect(() => decodeCursor(bad), bad).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
});

describe('likePattern', () => {
  it('matches anywhere and escapes the wildcards and the escape character', () => {
    expect(likePattern('abc')).toBe('%abc%');
    expect(likePattern('50%_a!b')).toBe('%50!%!_a!!b%');
  });
});

describe('historyKey', () => {
  it('percent-encodes the profile into one key segment', () => {
    expect(historyKey('prod')).toBe('history/prod');
    expect(historyKey('a/b c-d.e')).toBe('history/a%2Fb%20c%2Dd%2Ee');
  });
});
