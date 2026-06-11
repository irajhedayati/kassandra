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

  // Collection placeholders — used when no parametric type is available.
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
