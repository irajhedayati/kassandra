/**
 * Management view for saved queries: open in the editor, edit, delete,
 * export to a JSON file and import from one.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedQuery } from '@kassandra/shared';
import { deleteSavedQuery, importSavedQueries, listSavedQueries } from '../../api/savedQueries.js';
import { useCqlDraft } from '../../state/cqlDraft.js';
import { SaveQueryDialog } from './SaveQueryDialog.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

const btn =
  'rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50';

export function SavedQueriesDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const pushQuery = useCqlDraft((s) => s.pushQuery);
  const [editing, setEditing] = useState<SavedQuery | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listQuery = useQuery({ queryKey: ['saved-queries'], queryFn: listSavedQueries, enabled: open });
  const queries = listQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSavedQuery(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-queries'] }),
    onError: (err: unknown) => setMessage(err instanceof Error ? err.message : String(err)),
  });

  const importMutation = useMutation({
    mutationFn: importSavedQueries,
    onSuccess: async (r) => {
      setMessage(
        `Imported: ${r.created} new, ${r.updated} updated` +
          (r.skipped.length > 0
            ? `, ${r.skipped.length} skipped (${r.skipped.map((s) => `${s.name}: ${s.message}`).join('; ')})`
            : ''),
      );
      await queryClient.invalidateQueries({ queryKey: ['saved-queries'] });
    },
    onError: (err: unknown) => setMessage(err instanceof Error ? err.message : String(err)),
  });

  function exportAll() {
    const blob = new Blob([JSON.stringify({ saved_queries: queries }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kassandra-saved-queries.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File) {
    setMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { saved_queries?: unknown }).saved_queries)
          ? (parsed as { saved_queries: unknown[] }).saved_queries
          : null;
      if (!list) {
        setMessage('No saved queries found in that file.');
        return;
      }
      importMutation.mutate(list);
    } catch (err) {
      setMessage(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Saved queries</h2>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => fileInputRef.current?.click()}>
              Import
            </button>
            <button type="button" className={btn} onClick={exportAll} disabled={queries.length === 0}>
              Export
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {message && (
          <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {message}
          </div>
        )}

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {listQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : queries.length === 0 ? (
            <p className="text-sm text-slate-500">
              No saved queries yet. Use “Save query” in the CQL editor.
            </p>
          ) : (
            queries.map((q) => (
              <div key={q.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{q.name}</p>
                    {q.description && <p className="text-sm text-slate-600">{q.description}</p>}
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-slate-700">
                      {q.query}
                    </pre>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      onClick={() => {
                        pushQuery(q.query, q.paramTypes);
                        onClose();
                      }}
                    >
                      Open
                    </button>
                    <button type="button" className={btn} onClick={() => setEditing(q)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${btn} text-red-600`}
                      onClick={() => {
                        if (window.confirm(`Delete saved query "${q.name}"?`)) {
                          deleteMutation.mutate(q.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {editing && (
        <SaveQueryDialog key={editing.id} open existing={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
