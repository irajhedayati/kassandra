import type { ApiResponse, QueryResponse } from '@py-sandra/shared';

/**
 * Thin fetch wrapper. All backend routes return either ApiResponse<T>
 * (for non-query endpoints) or QueryResponse (for data/cql endpoints).
 */

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  return unwrap<T>(res);
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as ApiResponse<T> | QueryResponse;
  if ('ok' in json) {
    if (json.ok) return json.data as T;
    throw new ApiError(json.message, res.status);
  }
  // QueryResponse — caller wants the envelope verbatim.
  if (!res.ok && 'success' in json && !json.success) {
    throw new ApiError(json.message, res.status);
  }
  return json as T;
}
