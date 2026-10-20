import type { ApiResponse, QueryResponse } from '@kassandra/shared';

/**
 * Thin fetch wrapper. All backend routes return either ApiResponse<T>
 * (for non-query endpoints) or QueryResponse (for data/cql endpoints).
 */

const SESSION_KEY = 'kassandra.session';
const SESSION_HEADER = 'X-Kassandra-Session';

/**
 * Identifies this browser tab to the server, which keeps one Cassandra
 * connection per id. sessionStorage is per tab and survives reloads, so a
 * reload stays connected while other tabs/windows get their own connection.
 */
function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'default';
  }
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { [SESSION_HEADER]: sessionId() } });
  return unwrap<T>(res);
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', [SESSION_HEADER]: sessionId() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return unwrap<T>(res);
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as ApiResponse<T> | QueryResponse;
  if ('ok' in json) {
    if (json.ok) return json.data as T;
    throw new ApiError(json.message, res.status);
  }
  // QueryResponse; caller wants the envelope verbatim.
  if (!res.ok && 'success' in json && !json.success) {
    throw new ApiError(json.message, res.status);
  }
  return json as T;
}
