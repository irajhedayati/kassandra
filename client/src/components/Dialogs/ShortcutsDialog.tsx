/**
 * Keyboard shortcut cheat sheet. Pressing "/" anywhere outside a text field
 * toggles it; Escape or "/" closes it.
 */
import { useEffect, useState } from 'react';

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['/'], description: 'Show this list of shortcuts' },
  { keys: ['⌘ / Ctrl', 'Enter'], description: 'Execute the query in the CQL editor' },
  { keys: ['⌥ / Ctrl', 'D'], description: 'Delete the row open in Row detail (asks to confirm)' },
  { keys: ['Enter'], description: 'Confirm the open dialog (OK / Create / Save / Delete / Import)' },
  { keys: ['Esc'], description: 'Close this window' },
];

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || !!el.closest('input, textarea, select, .monaco-editor'));
}

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md rounded bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">Keyboard shortcuts</h2>
        <dl className="mt-4 space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.description} className="flex items-start justify-between gap-4 text-sm">
              <dt className="text-slate-700">{s.description}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && <span className="text-slate-400">+</span>}
                    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">
                      {k}
                    </kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={() => setOpen(false)}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
