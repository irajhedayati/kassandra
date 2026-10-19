/**
 * Monaco-based CQL editor + execute button. The content is split on `;` and
 * run statement by statement (at most one SELECT); an execution report shows
 * the state of each, and the SELECT's rows are rendered below as a table.
 *
 * Layout:
 *  - Mounted at the bottom of the main pane (see App.tsx).
 *  - Independent of keyspace/table selection; fires raw CQL against the
 *    active session.
 *
 * Shortcuts:
 *  - Cmd/Ctrl + Enter executes the current query (mirrors legacy
 *    `legacy/src/view/cql_view.py`).
 *
 * Owned by the cql lane.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import {
  extractParamNames,
  splitCqlStatements,
  type QueryResponse,
} from '@kassandra/shared';
import { execCql } from '../../api/cql.js';
import { describeSuccess } from '../../utils/cqlReport.js';
import { useCqlDraft } from '../../state/cqlDraft.js';
import { CqlResults } from './CqlResults.js';
import { CqlParams } from './CqlParams.js';
import { CqlExecutionReport, type StatementRun } from './CqlExecutionReport.js';
import { SaveQueryDialog } from '../Dialogs/SaveQueryDialog.js';
import { SavedQueriesDialog } from '../Dialogs/SavedQueriesDialog.js';
import { registerCqlCompletionProvider } from './cqlCompletion.js';

const DEFAULT_PAGE_SIZE = 100;

interface ExecInfo {
  startedAt: Date;
  durationMs: number;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function CqlEditor() {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState<string>('');
  // Rows of the SELECT statement, if any, and where it sits in `runs` (for paging).
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [runs, setRuns] = useState<StatementRun[]>([]);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [selectPos, setSelectPos] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [execInfo, setExecInfo] = useState<ExecInfo | null>(null);
  const [pagingState, setPagingState] = useState<string | null>(null);
  const [paramTypes, setParamTypes] = useState<Record<string, string>>({});
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const queryRef = useRef<string>('');
  const paramsRef = useRef<{ types: Record<string, string>; values: Record<string, string> }>({
    types: {},
    values: {},
  });
  paramsRef.current = { types: paramTypes, values: paramValues };
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pending = useCqlDraft((s) => s.pending);
  const clearPending = useCqlDraft((s) => s.clearPending);

  useEffect(() => () => completionDisposableRef.current?.dispose(), []);

  // Consume a query pushed from Insert/Update forms: load it into the
  // editor, expand it if collapsed, and scroll it into view.
  useEffect(() => {
    if (!pending) return;
    queryRef.current = pending.text;
    setQuery(pending.text);
    setParamTypes(pending.paramTypes ?? {});
    setParamValues({});
    setCollapsed(false);
    clearPending();
    requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [pending, clearPending]);

  const updateRun = (pos: number, patch: Partial<StatementRun>) =>
    setRuns((prev) => prev.map((r, i) => (i === pos ? { ...r, ...patch } : r)));

  const execStatement = async (text: string, ps: string | null): Promise<QueryResponse> => {
    const { types, values } = paramsRef.current;
    const params = Object.fromEntries(
      extractParamNames(text).map((n) => [n, { type: types[n] ?? 'text', value: values[n] ?? '' }]),
    );
    try {
      return await execCql({ query: text, pageSize: DEFAULT_PAGE_SIZE, pagingState: ps, params });
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  };

  /** Run every statement in the editor in order; stops at the first failure. */
  const runAll = useCallback(async () => {
    if (runningRef.current) return;
    setResult(null);
    setPagingState(null);
    setSelectPos(null);
    setExecInfo(null);
    setNotice(null);

    const statements = splitCqlStatements(queryRef.current);
    if (statements.length === 0) {
      setRuns([]);
      setNotice({ kind: 'info', text: 'Empty query' });
      return;
    }
    const selects = statements.filter((s) => s.command === 'SELECT');
    if (selects.length > 1) {
      setRuns([]);
      setNotice({
        kind: 'error',
        text: `Only one SELECT statement is allowed per execution, found ${selects.length} (#${selects
          .map((s) => s.index)
          .join(', #')}). Nothing was run.`,
      });
      return;
    }

    runningRef.current = true;
    setRunning(true);
    const startedAt = new Date();
    const t0 = performance.now();
    setRuns(statements.map((statement) => ({ statement, status: 'queued' })));
    try {
      for (let pos = 0; pos < statements.length; pos++) {
        const statement = statements[pos]!;
        updateRun(pos, { status: 'running' });
        const res = await execStatement(statement.text, null);
        if (!res.success) {
          setRuns((prev) =>
            prev.map((r, i) =>
              i === pos
                ? { ...r, status: 'failed', detail: res.message }
                : i > pos
                  ? { ...r, status: 'skipped' }
                  : r,
            ),
          );
          break;
        }
        updateRun(pos, { status: 'success', detail: describeSuccess(statement.command, res) });
        if (statement.command === 'SELECT') {
          setResult(res);
          setPagingState(res.pagingState);
          setSelectPos(pos);
        }
      }
    } finally {
      setExecInfo({ startedAt, durationMs: performance.now() - t0 });
      runningRef.current = false;
      setRunning(false);
    }
  }, []);

  /** Fetch the next page of the SELECT only; the other statements are not re-run. */
  const runNextPage = async () => {
    const run = selectPos === null ? undefined : runs[selectPos];
    if (!run || !pagingState || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const startedAt = new Date();
    const t0 = performance.now();
    updateRun(selectPos!, { status: 'running' });
    try {
      const res = await execStatement(run.statement.text, pagingState);
      if (res.success) {
        updateRun(selectPos!, { status: 'success', detail: describeSuccess('SELECT', res) });
        setResult(res);
        setPagingState(res.pagingState);
      } else {
        updateRun(selectPos!, { status: 'failed', detail: res.message });
        setPagingState(null);
      }
    } finally {
      setExecInfo({ startedAt, durationMs: performance.now() - t0 });
      runningRef.current = false;
      setRunning(false);
    }
  };

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => {
          // Always start a fresh run when triggered from the editor.
          void runAll();
        },
      );
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = registerCqlCompletionProvider(monaco);
    },
    [runAll],
  );

  const onChange = useCallback((value: string | undefined) => {
    const v = value ?? '';
    queryRef.current = v;
    setQuery(v);
  }, []);

  const onExecute = () => {
    void runAll();
  };

  const onNextPage = () => {
    void runNextPage();
  };

  const paramNames = extractParamNames(query);
  const hasMore = result?.success === true && result.hasMorePages && pagingState !== null;

  return (
    <div ref={containerRef} className="flex flex-col gap-3 px-6 py-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
          aria-expanded={!collapsed}
        >
          <span className={`inline-block transition-transform ${collapsed ? '-rotate-90' : ''}`}>▾</span>
          CQL Editor
        </button>
        <div className="flex items-center gap-2">
          {!collapsed && hasMore && (
            <button
              type="button"
              onClick={onNextPage}
              disabled={running}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next page
            </button>
          )}
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            disabled={!query.trim()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Save query
          </button>
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Saved queries
          </button>
          <button
            type="button"
            onClick={onExecute}
            disabled={running}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Execute Query'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="rounded border border-slate-200">
            <Editor
              height="240px"
              defaultLanguage="sql"
              language="sql"
              theme="vs-light"
              value={query}
              onChange={onChange}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
              }}
            />
          </div>

          <CqlParams
            names={paramNames}
            types={paramTypes}
            values={paramValues}
            onTypeChange={(n, t) => setParamTypes((p) => ({ ...p, [n]: t }))}
            onValueChange={(n, v) => setParamValues((p) => ({ ...p, [n]: v }))}
            onSubmit={onExecute}
          />

          <p className="text-xs text-slate-500">
            Separate several statements with <code>;</code> to run them one by one (at most one <code>SELECT</code>).
            Use <code>:name</code> for parameters. Press <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Cmd</kbd>/
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Ctrl</kbd> +{' '}
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Enter</kbd> to execute.
          </p>

          {notice && (
            <div
              className={`rounded border px-3 py-2 text-sm ${
                notice.kind === 'error'
                  ? 'border-red-300 bg-red-50 text-red-800'
                  : 'border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {notice.text}
            </div>
          )}

          <CqlExecutionReport runs={runs} />

          <CqlResults result={result} />

          {execInfo && !running && (
            <p className="text-xs text-slate-500" data-testid="cql-status">
              Executed {execInfo.startedAt.toLocaleString()} · took{' '}
              {formatDuration(execInfo.durationMs)}
            </p>
          )}
        </>
      )}

      {saveOpen && (
        <SaveQueryDialog
          open
          onClose={() => setSaveOpen(false)}
          initialQuery={query}
          initialParamTypes={paramTypes}
        />
      )}
      <SavedQueriesDialog open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}
