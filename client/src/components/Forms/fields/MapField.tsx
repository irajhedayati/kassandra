import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { getTypeInfo, isStringStringMap, type MapSchemaEntry, type WidgetKind } from '@kassandra/shared';
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

/** 'enum'/'JSON' are display-type overlays on top of text; everything else maps to a widget kind. */
type ValueWidget = WidgetKind | 'enum' | 'JSON';

function widgetFor(displayType: string): ValueWidget {
  if (displayType === 'enum' || displayType === 'JSON') return displayType;
  return getTypeInfo(displayType).widget;
}

/** Widgets that need more vertical space than a single inline row allows. */
const BLOCK_WIDGETS = new Set<ValueWidget>(['JSON', 'blob_hex']);

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

  const schemaByKey = new Map((mapSchema ?? []).map((s) => [s.key, s]));

  return (
    <div>
      <span className={labelClass}>{fieldLabel(column)}</span>
      <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
        {entries.length === 0 && (
          <p className="text-xs text-slate-400">No entries.</p>
        )}
        {entries.map((entry, i) => {
          const schemaEntry = schemaByKey.get(entry.key);
          const displayType = schemaEntry?.display_type ?? 'text';
          const enumValues = schemaEntry?.enum_values ?? [];
          const widget = widgetFor(displayType);
          const isBlock = BLOCK_WIDGETS.has(widget);

          const setValue = (v: string) => {
            const next = entries.slice();
            next[i] = { key: entry.key, value: v };
            update(next);
          };

          return (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                {schemaEntry ? (
                  <span
                    className={`${inputClass} flex-1 truncate bg-slate-100 text-slate-700`}
                    title={`Key: ${entry.key}`}
                  >
                    {(schemaEntry?.label?.trim() || '') || entry.key}
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
                {isBlock ? (
                  <span className="flex-1 text-xs text-slate-400">
                    {widget === 'JSON' ? 'JSON' : 'blob'} — edit below
                  </span>
                ) : widget === 'enum' ? (
                  <select
                    className={`${inputClass} flex-1`}
                    value={entry.value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                  >
                    <option value="">-- select --</option>
                    {(entry.value && !enumValues.includes(entry.value) ? [entry.value, ...enumValues] : enumValues).map(
                      (v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ),
                    )}
                  </select>
                ) : widget === 'checkbox' ? (
                  <label className="flex flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={entry.value === 'true' || entry.value === '1'}
                      disabled={disabled}
                      onChange={(e) => setValue(e.target.checked ? 'true' : 'false')}
                    />
                    <span className="text-sm text-slate-600">{entry.value || 'false'}</span>
                  </label>
                ) : widget === 'number_int' || widget === 'number_float' ? (
                  <input
                    type="number"
                    step={widget === 'number_float' ? 'any' : '1'}
                    className={`${inputClass} flex-1`}
                    value={entry.value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : widget === 'date' ? (
                  <input
                    type="date"
                    className={`${inputClass} flex-1`}
                    value={entry.value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : widget === 'time' ? (
                  <input
                    type="time"
                    step="1"
                    className={`${inputClass} flex-1`}
                    value={entry.value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : widget === 'datetime' ? (
                  <input
                    type="datetime-local"
                    step="1"
                    className={`${inputClass} flex-1`}
                    value={entry.value.endsWith('Z') ? entry.value.slice(0, -1) : entry.value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : (
                  <input
                    className={`${inputClass} flex-1`}
                    value={entry.value}
                    placeholder={
                      widget === 'uuid'
                        ? 'UUID (auto-generated if empty)'
                        : widget === 'inet'
                          ? 'IP address'
                          : widget === 'duration'
                            ? 'e.g. 12h30m'
                            : 'value'
                    }
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
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
              {widget === 'JSON' && (
                <div className="overflow-hidden rounded border border-slate-300" style={{ height: 120 }}>
                  <Editor
                    height="100%"
                    defaultLanguage="json"
                    language="json"
                    theme="vs-light"
                    value={entry.value}
                    onChange={(v: string | undefined) => setValue(v ?? '')}
                    options={{
                      readOnly: disabled,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 12,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: 'on',
                      lineNumbers: 'off',
                      folding: false,
                    }}
                  />
                </div>
              )}
              {widget === 'blob_hex' && (
                <textarea
                  className={textareaClass}
                  rows={2}
                  value={entry.value}
                  disabled={disabled}
                  placeholder="Hex string"
                  spellCheck={false}
                  onChange={(e) => setValue(e.target.value)}
                />
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
