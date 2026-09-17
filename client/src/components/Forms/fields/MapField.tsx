import { useEffect, useRef, useState } from 'react';
import { isStringStringMap, type MapSchemaEntry } from '@kassandra/shared';
import {
  fieldLabel,
  labelClass,
  inputClass,
  textareaClass,
  type FieldProps,
} from './index.js';

interface Entry {
  key: string;
  value: string;
}

function parseEntries(value: string): Entry[] {
  if (!value || !value.trim()) return [];
  try {
    const obj = JSON.parse(value);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.entries(obj).map(([key, v]) => ({ key, value: String(v ?? '') }));
    }
  } catch {
    // fall through; return empty, treat as unparsable
  }
  return [];
}

/**
 * Merge in any `map_schema`-defined keys missing from `entries`, as empty
 * rows ready for the user to fill in. Purely a display concern — these
 * rows are dropped again by `serializeEntries` until given a value, so an
 * untouched schema key never gets written to the column.
 */
function withSchemaKeys(entries: Entry[], mapSchema: MapSchemaEntry[] | undefined): Entry[] {
  if (!mapSchema || mapSchema.length === 0) return entries;
  const present = new Set(entries.map((e) => e.key));
  const missing = mapSchema.filter((s) => !present.has(s.key)).map((s) => ({ key: s.key, value: '' }));
  return missing.length === 0 ? entries : [...entries, ...missing];
}

function serializeEntries(entries: Entry[]): string {
  const obj: Record<string, string> = {};
  for (const { key, value } of entries) {
    // Drop rows with no key, and rows whose value was never filled in
    // (e.g. an empty entry seeded from the column's `map_schema`) — an
    // untouched blank row should not be written as an empty-string value.
    if (key.trim() === '' || value === '') continue;
    obj[key] = value;
  }
  return JSON.stringify(obj);
}

/**
 * Key/value tuple editor for `map<string, string>` columns. Falls back to a
 * raw JSON-object textarea for maps with non-string-string key/value types.
 *
 * Entries are kept in local state (rather than re-derived from `value` on
 * every render) because serialization drops rows with an empty/duplicate
 * key; re-parsing after each keystroke would make newly-added or
 * in-progress rows disappear.
 */
export function MapField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder, mapSchema } = props;

  const isTupleEditor = isStringStringMap(column.cql_type);
  const [entries, setEntries] = useState<Entry[]>(() => withSchemaKeys(parseEntries(value), mapSchema));
  const lastEmitted = useRef<string>(value);

  useEffect(() => {
    // Only resync from the parent-controlled value when it changed for a
    // reason other than our own onChange (e.g. switching rows in RowDetail).
    if (value !== lastEmitted.current) {
      setEntries(withSchemaKeys(parseEntries(value), mapSchema));
      lastEmitted.current = value;
    }
  }, [value, mapSchema]);

  if (!isTupleEditor) {
    return (
      <label className="block">
        <span className={labelClass}>{fieldLabel(column)}</span>
        <textarea
          className={textareaClass}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? 'JSON object: {"key": "value"}'}
          spellCheck={false}
        />
      </label>
    );
  }

  function update(next: Entry[]) {
    setEntries(next);
    const serialized = serializeEntries(next);
    lastEmitted.current = serialized;
    onChange(serialized);
  }

  const labelByKey = new Map((mapSchema ?? []).map((s) => [s.key, s.label]));

  return (
    <div>
      <span className={labelClass}>{fieldLabel(column)}</span>
      <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
        {entries.length === 0 && (
          <p className="text-xs text-slate-400">No entries.</p>
        )}
        {entries.map((entry, i) => {
          const schemaLabel = labelByKey.get(entry.key);
          return (
            <div key={i} className="flex items-center gap-1.5">
              {schemaLabel ? (
                <span
                  className={`${inputClass} flex-1 truncate bg-slate-100 text-slate-700`}
                  title={`Key: ${entry.key}`}
                >
                  {schemaLabel}
                </span>
              ) : (
                <input
                  className={`${inputClass} flex-1`}
                  value={entry.key}
                  placeholder="key"
                  disabled={disabled}
                  onChange={(e) => {
                    const next = entries.slice();
                    next[i] = { key: e.target.value, value: entry.value };
                    update(next);
                  }}
                />
              )}
              <span className="text-slate-400">:</span>
              <input
                className={`${inputClass} flex-1`}
                value={entry.value}
                placeholder="value"
                disabled={disabled}
                onChange={(e) => {
                  const next = entries.slice();
                  next[i] = { key: entry.key, value: e.target.value };
                  update(next);
                }}
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => update(entries.filter((_, j) => j !== i))}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove entry"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {!disabled && (
          <button
            type="button"
            onClick={() => update([...entries, { key: '', value: '' }])}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
          >
            + Add entry
          </button>
        )}
      </div>
    </div>
  );
}
