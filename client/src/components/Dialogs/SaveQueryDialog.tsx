/**
 * Save the editor's current query (with its parameter types) as a named
 * saved query. Also used to edit a saved query's metadata and text.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { extractParamNames, type SavedQuery } from '@kassandra/shared';
import { createSavedQuery, updateSavedQuery } from '../../api/savedQueries.js';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Present when editing an existing saved query. */
  existing?: SavedQuery;
  initialQuery?: string;
  initialParamTypes?: Record<string, string>;
}

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export function SaveQueryDialog({ open, onClose, existing, initialQuery, initialParamTypes }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [query, setQuery] = useState(existing?.query ?? initialQuery ?? '');
  const [error, setError] = useState<string | null>(null);
  const paramTypes = existing?.paramTypes ?? initialParamTypes ?? {};
  const params = extractParamNames(query);

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        description: description.trim(),
        query,
        // Keep only types for names still present in the query.
        paramTypes: Object.fromEntries(params.map((p) => [p, paramTypes[p] ?? 'text'])),
      };
      return existing ? updateSavedQuery(existing.id, input) : createSavedQuery(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['saved-queries'] });
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  if (!open) return null;

  const canSubmit = name.trim() !== '' && query.trim() !== '' && !mutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">
          {existing ? 'Edit saved query' : 'Save query'}
        </h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Orders by user"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea
              className={inputClass}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Query</label>
            <textarea
              className={`${inputClass} font-mono text-xs`}
              rows={5}
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SELECT * FROM shop.orders WHERE user_id = :userId"
            />
            <p className="mt-1 text-xs text-slate-500">
              {params.length > 0
                ? `Parameters: ${params.map((p) => `:${p} (${paramTypes[p] ?? 'text'})`).join(', ')}`
                : 'No :name parameters detected.'}
            </p>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
