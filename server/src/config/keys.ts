/** Keys are `/`-separated segments of [A-Za-z0-9_%.-] that do not start with `.` or `-`. */
const SEGMENT = /^[A-Za-z0-9_%][A-Za-z0-9_%.-]*$/;

/** The key's segments; throws on a key a storage must not accept. */
export function keySegments(key: string): string[] {
  const segments = key.split('/');
  if (!segments.every((s) => SEGMENT.test(s))) throw new Error(`Invalid storage key: ${key}`);
  return segments;
}
