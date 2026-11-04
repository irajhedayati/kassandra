/**
 * Config changes are read-modify-write cycles. Storage calls are async, so two
 * concurrent requests could interleave and lose an update; funnel them through
 * one queue instead.
 */
let tail: Promise<unknown> = Promise.resolve();

export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(fn, fn);
  tail = result.catch(() => undefined);
  return result;
}
