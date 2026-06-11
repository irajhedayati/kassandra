/**
 * Generic API envelope for non-query endpoints.
 * Routes that return a typed payload should use these helpers.
 */

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  message: string;
  /** Optional error code for the client to switch on. */
  code?: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;
