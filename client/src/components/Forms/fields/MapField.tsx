import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { OptionDropdown } from '../../OptionDropdown.js';
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
  /** UI-only: a freshly added row still waiting for the user to choose a key from the defined keys. */
  picking?: boolean;
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

interface KeyPickerProps {
  options: MapSchemaEntry[];
  onPick: (key: string) => void;
}

const CUSTOM_KEY = '\u0000custom';

/**
 * Searchable dropdown of the column's defined map keys. Typing filters by
 * key or label; a typed string that isn't a defined key can still be used
 * as a custom key, so maps aren't limited to the defined set.
 */
function KeyPicker({ options, onPick }: KeyPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const needle = filter.trim().toLowerCase();
  const matches = needle
    ? options.filter(
        (o) => o.key.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle),
      )
    : options;
  const typed = filter.trim();
  const rows: { id: string; key: string; title: string; hint?: string }[] = [
    ...matches.map((o) => ({
      id: o.key,
      key: o.key,
      title: o.label.trim() || o.key,
      ...(o.label.trim() && o.label.trim() !== o.key ? { hint: o.key } : {}),
    })),
    ...(typed && !options.some((o) => o.key === typed)
      ? [{ id: CUSTOM_KEY, key: typed, title: `Use "${typed}" as a custom key` }]
      : []),
    ...(!typed ? [{ id: CUSTOM_KEY, key: '', title: 'Custom key…' }] : []),
  ];

  const pick = (row: { key: string }) => {
    setOpen(false);
    setFilter('');
    onPick(row.key);
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setActive(0);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${inputClass} flex items-center justify-between text-left text-slate-400`}
      >
        Select a key…
        <span>▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-full min-w-56 rounded border border-slate-300 bg-white shadow-lg">
          <input
            autoFocus
            className="w-full border-b border-slate-200 px-2 py-1.5 text-sm focus:outline-none"
            placeholder="Search keys…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const row = rows[active];
                if (row) pick(row);
              }
            }}
          />
          <ul role="listbox" className="max-h-56 overflow-auto py-1 text-sm">
            {rows.length === 0 && <li className="px-3 py-1.5 text-slate-400">No matches</li>}
            {rows.map((row, idx) => (
              <li key={row.id + row.key} role="option" aria-selected={idx === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => pick(row)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left ${
                    idx === active ? 'bg-blue-50' : ''
                  } ${row.id === CUSTOM_KEY ? 'text-slate-500' : 'text-slate-900'}`}
                >
                  <span>{row.title}</span>
                  {row.hint && <span className="font-mono text-xs text-slate-400">{row.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
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
  const [entries, setEntries] = useState<Entry[]>(() => parseEntries(value));
  const lastEmitted = useRef<string>(value);

  useEffect(() => {
    // Only resync from the parent-controlled value when it changed for a
    // reason other than our own onChange (e.g. switching rows in RowDetail).
    if (value !== lastEmitted.current) {
      setEntries(parseEntries(value));
      lastEmitted.current = value;
    }
  }, [value]);

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
                {entry.picking ? (
                  <KeyPicker
                    options={(mapSchema ?? []).filter(
                      (o) => !entries.some((e, j) => j !== i && e.key === o.key),
                    )}
                    onPick={(key) => {
                      const next = entries.slice();
                      next[i] = { key, value: entry.value };
                      update(next);
                    }}
                  />
                ) : schemaEntry ? (
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
                  <div className="flex-1">
                    <OptionDropdown
                      label={`Value for ${entry.key}`}
                      value={entry.value}
                      options={[
                        { value: '', label: '-- select --' },
                        ...(entry.value && !enumValues.includes(entry.value)
                          ? [entry.value, ...enumValues]
                          : enumValues
                        ).map((v) => ({ value: v, label: v })),
                      ]}
                      onChange={setValue}
                      disabled={disabled}
                      buttonClassName="w-full px-2 py-1.5"
                      listClassName="w-full"
                    />
                  </div>
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
            onClick={() =>
              update([
                ...entries,
                // With defined keys, start by picking one (or a custom key) from the dropdown.
                { key: '', value: '', picking: (mapSchema?.length ?? 0) > 0 },
              ])
            }
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
          >
            + Add entry
          </button>
        )}
      </div>
    </div>
  );
}
