/**
 * Type mapping from CQL types to widget kinds and JS primitive types.
 * Mirrors legacy/src/utils/type_mapping.py.
 *
 * The frontend uses `widget` to pick the field component;
 * the server uses `js_type` to coerce values before binding to the driver.
 */

export type WidgetKind =
  | 'text'
  | 'textarea'
  | 'number_int'
  | 'number_float'
  | 'checkbox'
  | 'date'
  | 'time'
  | 'datetime'
  | 'uuid'
  | 'json'
  | 'list'
  | 'set'
  | 'map'
  | 'blob_hex'
  | 'inet'
  | 'duration';

export interface CqlTypeInfo {
  /** Widget the client should render. */
  widget: WidgetKind;
  /** Optional placeholder/help text. */
  placeholder?: string;
  /** Whether values come over the wire as JSON-serialized strings. */
  json_encoded?: boolean;
}

export const CQL_TYPE_INFO: Record<string, CqlTypeInfo> = {
  ascii: { widget: 'text' },
  text: { widget: 'textarea' },
  varchar: { widget: 'textarea' },

  tinyint: { widget: 'number_int' },
  smallint: { widget: 'number_int' },
  int: { widget: 'number_int' },
  bigint: { widget: 'number_int' },
  varint: { widget: 'number_int' },
  counter: { widget: 'number_int' },

  float: { widget: 'number_float' },
  double: { widget: 'number_float' },
  decimal: { widget: 'text' },

  boolean: { widget: 'checkbox' },

  uuid: { widget: 'uuid', placeholder: 'UUID (auto-generated if empty)' },
  timeuuid: { widget: 'uuid', placeholder: 'TIMEUUID (auto-generated if empty)' },

  date: { widget: 'date' },
  time: { widget: 'time' },
  timestamp: { widget: 'datetime' },
  duration: { widget: 'duration', placeholder: 'e.g. 12h30m' },

  blob: { widget: 'blob_hex', placeholder: 'Hex string' },
  inet: { widget: 'inet', placeholder: 'IP address' },

  // Collection placeholders; used when no parametric type is available.
  list: { widget: 'list', json_encoded: true, placeholder: 'JSON array' },
  set: { widget: 'set', json_encoded: true, placeholder: 'JSON array' },
  map: { widget: 'map', json_encoded: true, placeholder: 'JSON object' },
  tuple: { widget: 'list', json_encoded: true, placeholder: 'JSON array' },
  frozen: { widget: 'json', json_encoded: true, placeholder: 'JSON' },
};

/**
 * Strip a parametric CQL type to its outer name.
 *   "list<text>"          → "list"
 *   "map<text, int>"      → "map"
 *   "frozen<map<...>>"    → "frozen"
 *   "text"                → "text"
 */
export function rootCqlType(cqlType: string): string {
  const lt = cqlType.indexOf('<');
  return (lt === -1 ? cqlType : cqlType.slice(0, lt)).trim().toLowerCase();
}

export function getTypeInfo(cqlType: string): CqlTypeInfo {
  const root = rootCqlType(cqlType);
  return CQL_TYPE_INFO[root] ?? { widget: 'text' };
}

/**
 * Extract the key/value type parameters from a `map<K, V>` (optionally
 * `frozen<map<K, V>>`) CQL type string. Returns null for non-map types or
 * malformed generics.
 *   "map<text, text>"         → { keyType: "text", valueType: "text" }
 *   "frozen<map<text, int>>"  → { keyType: "text", valueType: "int" }
 */
export function mapKeyValueTypes(
  cqlType: string,
): { keyType: string; valueType: string } | null {
  const inner = cqlType.startsWith('frozen<') && cqlType.endsWith('>')
    ? cqlType.slice('frozen<'.length, -1)
    : cqlType;
  if (rootCqlType(inner) !== 'map') return null;
  const lt = inner.indexOf('<');
  const gt = inner.lastIndexOf('>');
  if (lt === -1 || gt === -1 || gt < lt) return null;
  const params = inner.slice(lt + 1, gt);
  const comma = params.indexOf(',');
  if (comma === -1) return null;
  return {
    keyType: params.slice(0, comma).trim(),
    valueType: params.slice(comma + 1).trim(),
  };
}

const STRING_LIKE_TYPES = new Set(['text', 'varchar', 'ascii']);

/** True when both the key and value of a map<K, V> are string-like CQL types. */
export function isStringStringMap(cqlType: string): boolean {
  const kv = mapKeyValueTypes(cqlType);
  if (!kv) return false;
  return STRING_LIKE_TYPES.has(kv.keyType.toLowerCase()) && STRING_LIKE_TYPES.has(kv.valueType.toLowerCase());
}
