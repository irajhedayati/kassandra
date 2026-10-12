/**
 * "Copy: MD CSV TSV JSON" button strip shared by the data grid and the CQL
 * results table. Serializes the given rows/columns and writes them to the
 * clipboard.
 */
import { useState } from 'react';
import type { Row } from '@kassandra/shared';

type Format = 'MD' | 'CSV' | 'TSV' | 'JSON';
const FORMATS: Format[] = ['MD', 'CSV', 'TSV', 'JSON'];

interface Props {
  columns: string[];
  rows: Row[];
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function serializeRows(format: Format, columns: string[], rows: Row[]): string {
  const grid = rows.map((r) => columns.map((c) => cellText(r[c])));
  switch (format) {
    case 'MD': {
      const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      return [
        `| ${columns.map(esc).join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...grid.map((r) => `| ${r.map(esc).join(' | ')} |`),
      ].join('\n');
    }
    case 'CSV': {
      const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
      return [columns, ...grid].map((r) => r.map(esc).join(',')).join('\n');
    }
    case 'TSV': {
      const esc = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
      return [columns, ...grid].map((r) => r.map(esc).join('\t')).join('\n');
    }
    case 'JSON':
      return JSON.stringify(
        rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))),
        null,
        2,
      );
  }
}

export function CopyBar({ columns, rows }: Props) {
  const [status, setStatus] = useState<string | null>(null);

  const copy = async (format: Format) => {
    try {
      await navigator.clipboard.writeText(serializeRows(format, columns, rows));
      setStatus(`Copied ${format}`);
    } catch {
      setStatus('Copy failed');
    }
    setTimeout(() => setStatus(null), 1500);
  };

  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <span>Copy:</span>
      {FORMATS.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => void copy(f)}
          disabled={rows.length === 0}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {f}
        </button>
      ))}
      {status && <span className="text-xs text-slate-500">{status}</span>}
    </div>
  );
}
