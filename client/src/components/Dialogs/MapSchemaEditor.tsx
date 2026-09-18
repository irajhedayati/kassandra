import { useState } from 'react';
import { CQL_TYPE_INFO, type MapSchemaEntry } from '@kassandra/shared';

interface Props {
  column: string;
  initial: MapSchemaEntry[];
  onSave: (entries: MapSchemaEntry[]) => void;
  onCancel: () => void;
  saving?: boolean;
  errorMessage?: string | null;
}

// Collection root types don't make sense as a scalar map value; 'JSON' and
// 'enum' are display-type overlays on top of text (same vocabulary as
// text-column display types elsewhere), not real CQL types.
const NON_SCALAR_ROOTS = new Set(['list', 'set', 'map', 'tuple', 'frozen', 'json', 'text']);
const SCALAR_TYPES = Object.keys(CQL_TYPE_INFO).filter((t) => !NON_SCALAR_ROOTS.has(t)).sort();
const TYPES = ['text', 'JSON', 'enum', ...SCALAR_TYPES] as const;

function enumValuesToText(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}

function parseEnumValuesText(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/**
 * Map-schema editor: edit the list of { key, label, display_type,
 * enum_values } entries that describe the known keys of a Cassandra map
 * column. `display_type` picks the widget MapField renders for that key's
 * value (plain text, JSON with syntax highlighting, or a dropdown of
 * user-defined enum values) — the same vocabulary used for text columns
 * elsewhere in Table Info.
 */
export function MapSchemaEditor(props: Props) {
  const [entries, setEntries] = useState<MapSchemaEntry[]>(
    props.initial.length > 0 ? props.initial : [],
  );
  // Raw enum-values text per row index, so commas/spaces mid-typing aren't
  // immediately re-split/collapsed (mirrors TableInfo's enumDrafts).
  const [enumDrafts, setEnumDrafts] = useState<Record<number, string>>({});

  const addEntry = () => {
    setEntries((prev) => [...prev, { key: '', label: '' }]);
  };

  const removeEntry = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
    setEnumDrafts((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const updateEntry = (idx: number, patch: Partial<MapSchemaEntry>) => {
    setEntries((prev) => prev.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry)));
  };

  const handleSave = () => {
    const cleaned = entries
      .map((e) => ({
        key: (e.key ?? '').trim(),
        label: (e.label ?? '').trim(),
        ...(e.display_type ? { display_type: e.display_type } : {}),
        ...(e.display_type === 'enum' ? { enum_values: e.enum_values ?? [] } : {}),
      }))
      .filter((e) => e.key !== '');
    props.onSave(cleaned);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Edit Map Schema</h2>
        <p className="mb-4 text-sm text-slate-500">
          Define known keys for column <span className="font-mono">{props.column}</span>.
        </p>

        <div className="mb-4 max-h-96 overflow-y-auto">
          <div className="mb-2 grid grid-cols-[1fr_1fr_120px_auto] gap-2 text-xs font-semibold text-slate-600">
            <div>Key</div>
            <div>Label</div>
            <div>Type</div>
            <div className="w-8" />
          </div>
          {entries.length === 0 ? (
            <div className="py-4 text-sm text-slate-500">
              No entries. Click &quot;Add row&quot; to get started.
            </div>
          ) : (
            entries.map((entry, idx) => {
              const displayType = entry.display_type ?? 'text';
              return (
                <div key={idx} className="mb-2 rounded border border-slate-100 p-1.5">
                  <div className="grid grid-cols-[1fr_1fr_120px_auto] items-center gap-2">
                    <input
                      type="text"
                      value={entry.key ?? ''}
                      onChange={(e) => updateEntry(idx, { key: e.target.value })}
                      placeholder="key"
                      disabled={props.saving}
                      className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={entry.label ?? ''}
                      onChange={(e) => updateEntry(idx, { label: e.target.value })}
                      placeholder="label"
                      disabled={props.saving}
                      className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <select
                      value={displayType}
                      onChange={(e) => updateEntry(idx, { display_type: e.target.value })}
                      disabled={props.saving}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeEntry(idx)}
                      disabled={props.saving}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      aria-label={`Remove row ${idx + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                  {displayType === 'enum' && (
                    <input
                      type="text"
                      value={enumDrafts[idx] ?? enumValuesToText(entry.enum_values)}
                      onChange={(e) => setEnumDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                      onBlur={(e) => updateEntry(idx, { enum_values: parseEnumValuesText(e.target.value) })}
                      placeholder="value1, value2, value3"
                      disabled={props.saving}
                      className="mt-1.5 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="mb-4">
          <button
            type="button"
            onClick={addEntry}
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          >
            + Add row
          </button>
        </div>

        {props.errorMessage && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Save failed: {props.errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.saving}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={props.saving}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {props.saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
