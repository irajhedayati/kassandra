import type { ErrorRequestHandler } from 'express';

/**
 * Last-resort error handler. Routes that throw synchronously or reject
 * an awaited promise land here. If the error has a `.status` numeric
 * property, that becomes the HTTP code.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  if (status >= 500) console.error('[kassandra] unhandled error', err);
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ ok: false, message });
};
