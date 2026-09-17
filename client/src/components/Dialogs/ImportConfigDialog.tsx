/**
 * Import connection profiles from a JSON file (drag-and-drop or file
 * picker) or pasted JSON text.
 *
 * Accepts either a single profile object, an array of profiles, or a
 * `{ connections: [...] }` wrapper (the shape `AppSettings`/config.json
 * uses on disk), so users can drop an exported config.json straight in.
 * Each profile is upserted via the existing POST /api/profiles route,
 * which already validates + persists it server-side.
 */
import { useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileArrowUp, faUpload } from '@fortawesome/free-solid-svg-icons';
import type { ConnectionProfile } from '@kassandra/shared';
import { createProfile } from '../../api/connection.js';
import { ApiError } from '../../api/client.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

type SourceTab = 'file' | 'paste';

interface ImportOutcome {
  imported: string[];
  failed: { name: string; message: string }[];
}

/** Pull a list of candidate profile objects out of whatever shape the JSON turned out to be. */
function extractProfiles(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.connections)) return obj.connections;
    return [parsed];
  }
  return [];
}

export function ImportConfigDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SourceTab>('file');
  const [jsonText, setJsonText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: async (candidates: unknown[]) => {
      const result: ImportOutcome = { imported: [], failed: [] };
      for (const candidate of candidates) {
        const name =
          candidate && typeof candidate === 'object' && typeof (candidate as { name?: unknown }).name === 'string'
            ? (candidate as { name: string }).name
            : '(unnamed)';
        try {
          await createProfile(candidate as ConnectionProfile);
          result.imported.push(name);
        } catch (err) {
          const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
          result.failed.push({ name, message });
        }
      }
      return result;
    },
    onSuccess: async (result) => {
      setOutcome(result);
      if (result.imported.length > 0) {
        await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      }
    },
  });

  function reset() {
    setTab('file');
    setJsonText('');
    setFileName(null);
    setDragOver(false);
    setParseError(null);
    setOutcome(null);
    importMutation.reset();
  }

  function close() {
    reset();
    onClose();
  }

  function loadFile(file: File) {
    setParseError(null);
    setOutcome(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setJsonText(String(reader.result ?? ''));
      setTab('paste');
    };
    reader.onerror = () => {
      setParseError(`Could not read "${file.name}".`);
    };
    reader.readAsText(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }

  function handleImport() {
    setParseError(null);
    setOutcome(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      setParseError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const candidates = extractProfiles(parsed);
    if (candidates.length === 0) {
      setParseError('No connection profiles found in the provided JSON.');
      return;
    }
    importMutation.mutate(candidates);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Import configuration</h2>
        <p className="mt-1 text-sm text-slate-600">
          Import one or more connection profiles from a JSON file or pasted JSON.
        </p>

        <div className="mt-4 flex gap-1 border-b border-slate-200">
          {(['file', 'paste'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium ${
                tab === t
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'file' ? 'Upload file' : 'Paste JSON'}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === 'file' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed px-4 py-10 text-center text-sm transition ${
                dragOver
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-300 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              <FontAwesomeIcon icon={faFileArrowUp} className="text-2xl" />
              <p>
                Drag and drop a <span className="font-mono">.json</span> file here, or click to browse.
              </p>
              {fileName && <p className="text-xs text-slate-500">Loaded: {fileName}</p>}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadFile(file);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{"name": "prod", "hosts": ["10.0.0.1"], "port": 9042, ...}'
              rows={10}
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          )}
        </div>

        {parseError && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {parseError}
          </div>
        )}

        {outcome && (
          <div className="mt-3 space-y-1 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            {outcome.imported.length > 0 && (
              <p className="text-green-700">
                Imported {outcome.imported.length} profile{outcome.imported.length === 1 ? '' : 's'}:{' '}
                <span className="font-medium">{outcome.imported.join(', ')}</span>
              </p>
            )}
            {outcome.failed.length > 0 && (
              <div className="text-red-700">
                <p>Failed to import {outcome.failed.length}:</p>
                <ul className="ml-4 list-disc">
                  {outcome.failed.map((f) => (
                    <li key={f.name}>
                      {f.name}: {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {outcome ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!jsonText.trim() || importMutation.isPending}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            <FontAwesomeIcon icon={faUpload} />
            {importMutation.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
