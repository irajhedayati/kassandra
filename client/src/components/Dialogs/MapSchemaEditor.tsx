import { useState } from 'react';
import type { MapSchemaEntry } from '@py-sandra/shared';

interface Props {
  column: string;
  initial: MapSchemaEntry[];
  onSave: (entries: MapSchemaEntry[]) => void;
  onCancel: () => void;
  saving?: boolean;
}

/**
 * Map-schema editor: edit the list of { key, label } entries that
 * describe the known keys of a Cassandra map column. Used by the
 * Table Info panel to attach metadata to a `map<...>` column.
 */
export function MapSchemaEditor(props: Props) {
  const [entries, setEntries] = useState<MapSchemaEntry[]>(
    props.initial.length > 0 ? props.initial : [],
  );

  const addEntry = () => {
    setEntries((prev) => [...prev, { key: '', label: '' }]);
  };

  const removeEntry = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateEntry = (idx: number, field: 'key' | 'label', value: string) => {
    setEntries((prev) =>
      prev.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleSave = () => {
    const cleaned = entries
      .map((e) => ({ key: e.key.trim(), label: e.label.trim() }))
      .filter((e) => e.key !== '');
    props.onSave(cleaned);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Edit Map Schema</h2>
        <p className="mb-4 text-sm text-slate-500">
          Define known keys for column <span className="font-mono">{props.column}</span>.
        </p>

        <div className="mb-4 max-h-96 overflow-y-auto">
          <div className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-semibold text-slate-600">
            <div>Key</div>
            <div>Label</div>
            <div className="w-8" />
          </div>
          {entries.length === 0 ? (
            <div className="py-4 text-sm text-slate-500">
              No entries. Click &quot;Add row&quot; to get started.
            </div>
          ) : (
            entries.map((entry, idx) => (
              <div
                key={idx}
                className="mb-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2"
              >
                <input
                  type="text"
                  value={entry.key}
                  onChange={(e) => updateEntry(idx, 'key', e.target.value)}
                  placeholder="key"
                  className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={entry.label}
                  onChange={(e) => updateEntry(idx, 'label', e.target.value)}
                  placeholder="label"
                  className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeEntry(idx)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  aria-label={`Remove row ${idx + 1}`}
                >
                  Remove
                </button>
              </div>
            ))
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
