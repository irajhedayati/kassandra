/**
 * Monaco-based CQL editor + execute button. Renders results below
 * (table view for SELECT, success/error chip for DDL/DML).
 *
 * Layout:
 *  - Mounted at the bottom of the main pane (see App.tsx).
 *  - Independent of keyspace/table selection — fires raw CQL against the
 *    active session.
 *
 * Shortcuts:
 *  - Cmd/Ctrl + Enter executes the current query (mirrors legacy
 *    `legacy/src/view/cql_view.py`).
 *
 * Owned by the cql lane.
 */
import { useCallback, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { useMutation } from '@tanstack/react-query';
import type { QueryResponse } from '@py-sandra/shared';
import { execCql } from '../../api/cql.js';
import { CqlResults } from './CqlResults.js';

const DEFAULT_PAGE_SIZE = 100;

export function CqlEditor() {
  const [query, setQuery] = useState<string>('');
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [pagingState, setPagingState] = useState<string | null>(null);
  const queryRef = useRef<string>('');

  const mutation = useMutation<QueryResponse, Error, { query: string; pagingState: string | null }>({
    mutationFn: ({ query: q, pagingState: ps }) =>
      execCql({ query: q, pageSize: DEFAULT_PAGE_SIZE, pagingState: ps }),
    onSuccess: (data) => {
      setResult(data);
      if (data.success) {
        setPagingState(data.pagingState);
      } else {
        setPagingState(null);
      }
    },
    onError: (err) => {
      setResult({ success: false, message: err.message });
      setPagingState(null);
    },
  });

  const runQuery = useCallback(
    (nextPagingState: string | null) => {
      const q = queryRef.current;
      if (!q.trim()) {
        setResult({
          success: true,
          rows: [],
          pagingState: null,
          hasMorePages: false,
          message: 'Empty query',
        });
        setPagingState(null);
        return;
      }
      mutation.mutate({ query: q, pagingState: nextPagingState });
    },
    [mutation],
  );

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => {
          // Always start a fresh result set when triggered from the editor.
          runQuery(null);
        },
      );
    },
    [runQuery],
  );

  const onChange = useCallback((value: string | undefined) => {
    const v = value ?? '';
    queryRef.current = v;
    setQuery(v);
  }, []);

  const onExecute = () => {
    runQuery(null);
  };

  const onNextPage = () => {
    if (pagingState) runQuery(pagingState);
  };

  const hasMore = result?.success === true && result.hasMorePages && pagingState !== null;

  return (
    <div className="flex flex-col gap-3 px-6 py-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">CQL Editor</h2>
        <div className="flex items-center gap-2">
          {hasMore && (
            <button
              type="button"
              onClick={onNextPage}
              disabled={mutation.isPending}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next page
            </button>
          )}
          <button
            type="button"
            onClick={onExecute}
            disabled={mutation.isPending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Running…' : 'Execute Query'}
          </button>
        </div>
      </div>

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

      <p className="text-xs text-slate-500">
        Press <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Cmd</kbd>/
        <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Ctrl</kbd> +{' '}
        <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Enter</kbd> to execute.
      </p>

      <CqlResults result={result} />
    </div>
  );
}
