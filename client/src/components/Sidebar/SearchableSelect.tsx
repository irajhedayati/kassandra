/**
 * Minimal searchable dropdown (combobox) built from scratch — no external
 * listbox/combobox library is installed in this project. Filters options by
 * substring match as the user types; falls back to a plain option list when
 * the filter text is empty.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

interface SearchableSelectProps {
  value: string | null;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, filter]);

  const select = (option: string | null) => {
    onChange(option);
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
      >
        <span className={value ? '' : 'text-slate-400'}>{value ?? placeholder}</span>
        <span className="ml-2 text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
          <input
            autoFocus
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search…"
            className="w-full border-b border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none"
          />
          <ul className="max-h-56 overflow-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => select(null)}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-700"
              >
                {placeholder}
              </button>
            </li>
            {filtered.length === 0 && (
              <li className="px-3 py-1.5 text-sm text-slate-500">No matches</li>
            )}
            {filtered.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  onClick={() => select(option)}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-700 ${
                    option === value ? 'bg-slate-700 text-white' : 'text-slate-100'
                  }`}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
