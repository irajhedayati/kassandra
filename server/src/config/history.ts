/**
 * Query history pieces every backend shares: the per-profile cap, the order
 * (newest first), the opaque paging cursor, search matching and input
 * normalization, plus the document layout DocumentRepository uses:
 *
 *   key  history/{profile}      { "entries": QueryHistoryEntry[] }, newest first
 *   (file storage: {config dir}/history/{profile}.json)
 *
 * The profile is percent-encoded like the table documents (see tables.ts). The
 * history has its own document so that recording a query does not rewrite config.json.
 */
import crypto from 'node:crypto';
import type {
  QueryHistoryEntry,
  QueryHistoryInput,
  QueryHistoryListOptions,
  QueryHistoryPage,
} from '@kassandra/shared';
import type { ConfigStorage } from './storage.js';
import { encodePart } from './tables.js';

export const HISTORY_PREFIX = 'history/';
export const DEFAULT_HISTORY_LIMIT = 200;
export const DEFAULT_HISTORY_PAGE_SIZE = 50;
export const MAX_HISTORY_PAGE_SIZE = 500;

export class HistoryError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

let warnedLimit: string | undefined;

/** How many entries each profile keeps: KASSANDRA_HISTORY_LIMIT (a positive integer), else 200. */
export function historyLimit(): number {
  const raw = process.env.KASSANDRA_HISTORY_LIMIT?.trim();
  if (!raw) return DEFAULT_HISTORY_LIMIT;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  if (warnedLimit !== raw) {
    warnedLimit = raw;
    console.warn(`[kassandra] ignoring KASSANDRA_HISTORY_LIMIT=${raw} (not a positive integer); keeping ${DEFAULT_HISTORY_LIMIT}`);
  }
  return DEFAULT_HISTORY_LIMIT;
}

/** The requested page size, defaulted and clamped to 1..MAX_HISTORY_PAGE_SIZE. */
export function historyPageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_HISTORY_PAGE_SIZE;
  return Math.min(MAX_HISTORY_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

/** Give a new entry its id and normalize `started_at`; rejects (400) a time that cannot be parsed. */
export function newHistoryEntry(input: QueryHistoryInput): QueryHistoryEntry {
  const startedAt = new Date(input.started_at);
  if (Number.isNaN(startedAt.getTime())) throw new HistoryError(`Invalid started_at: ${input.started_at}`, 400);
  return {
    id: crypto.randomUUID(),
    profile: input.profile,
    query: input.query,
    params: input.params.map(({ name, type, value }) => ({ name, type, value })),
    started_at: startedAt.toISOString(),
    duration_ms: input.duration_ms,
    statements: input.statements,
    outcome: input.outcome,
    error: input.error ?? null,
  };
}

// --- order and paging ------------------------------------------------------------------------

/** Where an entry sits in the order: newest `started_at` first, ties broken by descending id. */
export interface HistoryPosition {
  startedAt: number;
  id: string;
}

export const positionOf = (entry: QueryHistoryEntry): HistoryPosition => ({
  startedAt: Date.parse(entry.started_at),
  id: entry.id,
});

/** Sort comparator for the history order. */
export function compareHistory(a: QueryHistoryEntry, b: QueryHistoryEntry): number {
  const [pa, pb] = [positionOf(a), positionOf(b)];
  if (pa.startedAt !== pb.startedAt) return pb.startedAt - pa.startedAt;
  return pa.id < pb.id ? 1 : pa.id > pb.id ? -1 : 0;
}

/** True if `entry` comes after `cursor` in the history order. */
export function isAfter(entry: QueryHistoryEntry, cursor: HistoryPosition): boolean {
  const p = positionOf(entry);
  return p.startedAt < cursor.startedAt || (p.startedAt === cursor.startedAt && p.id < cursor.id);
}

export function encodeCursor(entry: QueryHistoryEntry): string {
  const { startedAt, id } = positionOf(entry);
  return Buffer.from(JSON.stringify([startedAt, id])).toString('base64url');
}

/** Rejects (400) anything encodeCursor did not produce. */
export function decodeCursor(cursor: string): HistoryPosition {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    if (Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && typeof value[1] === 'string') {
      return { startedAt: value[0] as number, id: value[1] };
    }
  } catch {
    // fall through
  }
  throw new HistoryError('Invalid history cursor', 400);
}

/**
 * A page from `rows`: the backend fetched up to `size + 1` entries in order,
 * the extra one only telling whether there is a next page.
 */
export function toPage(rows: QueryHistoryEntry[], size: number): QueryHistoryPage {
  const entries = rows.slice(0, size);
  return { entries, next_cursor: rows.length > size ? encodeCursor(entries[entries.length - 1]!) : null };
}

// --- search ----------------------------------------------------------------------------------

/** The search term, or null when there is nothing to search for. */
export function searchTerm(options: QueryHistoryListOptions): string | null {
  return options.search ? options.search.toLowerCase() : null;
}

export const matchesSearch = (entry: QueryHistoryEntry, term: string | null): boolean =>
  term === null || entry.query.toLowerCase().includes(term);

/** Escape character of likePattern(), the same on every database. */
export const LIKE_ESCAPE = '!';

/** `term` as a LIKE pattern matching it anywhere, with `%` and `_` taken literally (escaped with `!`). */
export function likePattern(term: string): string {
  return `%${term.replace(/[!%_]/gu, (c) => `${LIKE_ESCAPE}${c}`)}%`;
}

// --- documents (DocumentRepository) ----------------------------------------------------------

export function historyKey(profile: string): string {
  return `${HISTORY_PREFIX}${encodePart(profile)}`;
}

/** A profile's history document, newest first; empty if there is none or it cannot be read. */
export async function readHistory(storage: ConfigStorage, profile: string): Promise<QueryHistoryEntry[]> {
  const key = historyKey(profile);
  try {
    const doc = (await storage.get(key)) as { entries?: unknown } | undefined;
    if (!doc || !Array.isArray(doc.entries)) return [];
    return (doc.entries as QueryHistoryEntry[])
      .filter((e) => e && typeof e.id === 'string' && typeof e.query === 'string' && typeof e.started_at === 'string')
      .map((e) => ({ ...e, profile, params: Array.isArray(e.params) ? e.params : [], error: e.error ?? null }))
      .sort(compareHistory);
  } catch (err) {
    console.warn(`[kassandra] could not read query history ${key}:`, err);
    return [];
  }
}

/** Write a profile's history (any order), or delete the document when it is empty. */
export async function writeHistory(storage: ConfigStorage, profile: string, entries: QueryHistoryEntry[]): Promise<void> {
  if (entries.length === 0) {
    await storage.delete(historyKey(profile));
    return;
  }
  await storage.put(historyKey(profile), { entries: [...entries].sort(compareHistory) });
}
