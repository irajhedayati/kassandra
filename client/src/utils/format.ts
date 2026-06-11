/**
 * Value <-> display formatters.
 *
 * Mirrors legacy/src/utils/type_mapping.py:format_value_for_display.
 *
 *  - map  -> JSON.stringify(value, null, 2)   (pretty-printed object)
 *  - set  -> JSON.stringify(value)             (treated as array on the wire)
 *  - list -> JSON.stringify(value)
 *  - blob -> hex string
 *  - timestamp / date / time -> ISO string
 */

import { rootCqlType } from '@py-sandra/shared';

const HEX_TABLE: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

function bytesToHex(value: unknown): string {
  if (value instanceof Uint8Array) {
    let out = '';
    for (let i = 0; i < value.length; i++) {
      out += HEX_TABLE[value[i]!];
    }
    return out;
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const b of value) {
      if (typeof b === 'number') {
        out += HEX_TABLE[b & 0xff];
      }
    }
    return out;
  }
  if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
    // Node Buffer JSON shape: { type: 'Buffer', data: number[] }
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return bytesToHex(data);
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}

function safeStringify(value: unknown, pretty: boolean): string {
  try {
    return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Format a Cassandra value for display in a form field or grid cell.
 */
export function formatValueForDisplay(value: unknown, cqlType: string): string {
  if (value === null || value === undefined) return '';
  const root = rootCqlType(cqlType);

  switch (root) {
    case 'map':
      // Map values come over JSON as plain objects; render pretty.
      return safeStringify(value, true);

    case 'set':
    case 'list':
    case 'tuple':
      return safeStringify(value, false);

    case 'frozen':
      return safeStringify(value, true);

    case 'blob':
      return bytesToHex(value);

    case 'timestamp':
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'number') return new Date(value).toISOString();
      return String(value);

    case 'date':
    case 'time':
      if (value instanceof Date) return value.toISOString();
      return String(value);

    case 'boolean':
      return value ? 'true' : 'false';

    default:
      if (isPlainObject(value) || Array.isArray(value)) {
        return safeStringify(value, false);
      }
      return String(value);
  }
}

/**
 * Format a value for use as the initial value of an editable text widget.
 * Keeps text/varchar values raw (no JSON wrapping).
 */
export function formatValueForEdit(value: unknown, cqlType: string): string {
  if (value === null || value === undefined) return '';
  const root = rootCqlType(cqlType);
  if (root === 'text' || root === 'varchar' || root === 'ascii') {
    return typeof value === 'string' ? value : String(value);
  }
  return formatValueForDisplay(value, cqlType);
}
