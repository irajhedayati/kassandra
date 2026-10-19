/**
 * Per-statement execution report for the raw CQL editor: one line per
 * statement, colored by state (green done, red failed, blue running, grey
 * queued). Statements after a failure are not run and show as skipped.
 */
import type { CqlStatement } from '@kassandra/shared';

export type StatementStatus = 'queued' | 'running' | 'success' | 'failed' | 'skipped';

export interface StatementRun {
  statement: CqlStatement;
  status: StatementStatus;
  /** Success summary or the error message. */
  detail?: string;
}

const STYLES: Record<StatementStatus, string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  failed: 'border-red-300 bg-red-50 text-red-800',
  running: 'border-blue-200 bg-blue-50 text-blue-800',
  queued: 'border-slate-200 bg-slate-100 text-slate-500',
  skipped: 'border-slate-200 bg-slate-100 text-slate-400',
};

const FALLBACK_DETAIL: Partial<Record<StatementStatus, string>> = {
  running: 'Running…',
  queued: 'Queued',
  skipped: 'Skipped (an earlier statement failed)',
};

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}

export function CqlExecutionReport({ runs }: { runs: StatementRun[] }) {
  if (runs.length === 0) return null;
  return (
    <ul className="space-y-1" data-testid="cql-report">
      {runs.map(({ statement, status, detail }) => (
        <li
          key={statement.index}
          data-status={status}
          title={statement.text}
          className={`flex items-start gap-2 rounded border px-3 py-1.5 text-sm ${STYLES[status]}`}
        >
          <span className="flex h-5 w-4 items-center">
            {(status === 'running' || status === 'queued') && <Spinner />}
          </span>
          <span className="font-mono text-xs leading-5">
            #{statement.index} {statement.command}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {detail ?? FALLBACK_DETAIL[status] ?? ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
