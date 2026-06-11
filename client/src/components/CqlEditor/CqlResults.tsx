/**
 * Renders the `QueryResponse` from the raw CQL editor.
 *
 *  - Error envelope → red message box.
 *  - Success with rows → table; columns are taken from `Object.keys(rows[0])`.
 *  - Success with no rows → green chip ("Statement executed.").
 *
 * Owned by the cql lane.
 */
import type { QueryResponse, Row } from '@kassandra/shared';

interface Props {
  result: QueryResponse | null;
}

export function CqlResults({ result }: Props) {
  if (!result) return null;

  if (!result.success) {
    return (
      <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
        {result.message}
      </div>
    );
  }

  if (result.rows.length === 0) {
    const message = result.message ?? 'Statement executed.';
    return (
      <div className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">
        {message}
      </div>
    );
  }

  const firstRow = result.rows[0];
  const columns = firstRow ? Object.keys(firstRow) : [];

  return (
    <div className="overflow-auto rounded border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100">
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 align-top font-mono text-xs text-slate-800">
                  {renderCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(value: Row[string] | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
