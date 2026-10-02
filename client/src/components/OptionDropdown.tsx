/**
 * Button + listbox dropdown where each option has a label and a helper line.
 * Used for enum-like choices (grid filter operators, replication strategy).
 */
import { useEffect, useRef, useState } from 'react';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  helperText: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Tailwind width class for the trigger button. */
  buttonClassName?: string;
  /** Tailwind width class for the option list. */
  listClassName?: string;
}

export function OptionDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  buttonClassName = 'w-40',
  listClassName = 'w-72',
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? options[0]!;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 ${buttonClassName}`}
      >
        {selected.label}
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute left-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded border border-slate-300 bg-white text-sm shadow-lg ${listClassName}`}
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${
                  o.value === value ? 'bg-blue-50' : ''
                }`}
              >
                <span className="block font-medium text-slate-900">{o.label}</span>
                <span className="block text-xs text-slate-500">{o.helperText}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
