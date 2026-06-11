/**
 * Confirmation modal for row deletion.
 * Shows the primary key values for the row that will be deleted.
 */
import type { Row } from '@kassandra/shared';

interface Props {
  open: boolean;
  /** Map of primary-key column → value, displayed for clarity. */
  keys: Row;
  loading: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDelete(props: Props) {
  if (!props.open) return null;

  const entries = Object.entries(props.keys);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Delete this row?</h2>
        <p className="mt-2 text-sm text-slate-600">
          This action cannot be undone. The row will be deleted by primary key:
        </p>

        <dl className="mt-3 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs">
          {entries.length === 0 ? (
            <span className="text-slate-500">(no primary key values provided)</span>
          ) : (
            entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <dt className="font-medium text-slate-700">{k}</dt>
                <dd className="truncate text-slate-600">{formatValue(v)}</dd>
              </div>
            ))
          )}
        </dl>

        {props.errorMessage && (
          <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {props.errorMessage}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.loading}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.loading}
            className="rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {props.loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '(null)';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
