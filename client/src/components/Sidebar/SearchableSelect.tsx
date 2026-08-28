/**
 * Searchable dropdown (combobox) built from scratch — no external
 * listbox/combobox library is installed in this project. Filters options by
 * substring match as the user types; falls back to a plain option list when
 * the filter text is empty. Visual/interaction behavior follows Preline's
 * "Advanced Select" pattern (checkmark on selection, keyboard navigation,
 * clear button): https://preline.co/docs/components/advanced-select.html
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
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const idx = value ? filtered.indexOf(value) : -1;
    setActiveIndex(idx >= 0 ? idx + 1 : 0);
  }, [open, filtered, value]);

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const select = (option: string | null) => {
    onChange(option);
    setOpen(false);
    setFilter('');
  };

  const openMenu = () => {
    setOpen(true);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Row 0 is the "clear" option; rows 1..n map to filtered[0..n-1].
  const rowCount = filtered.length + 1;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setFilter('');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rowCount - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      select(activeIndex === 0 ? null : filtered[activeIndex - 1] ?? null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
      >
        <span className={value ? '' : 'text-slate-400'}>{value ?? placeholder}</span>
        <span className="ml-2 flex items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                select(null);
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              aria-label="Clear selection"
            >
              ×
            </span>
          )}
          <span className="text-slate-400">▾</span>
        </span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search…"
            className="w-full border-b border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none"
          />
          <ul ref={listRef} className="max-h-56 overflow-auto py-1">
            <li>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(0)}
                onClick={() => select(null)}
                className={`block w-full px-3 py-1.5 text-left text-sm text-slate-400 ${
                  activeIndex === 0 ? 'bg-slate-700' : 'hover:bg-slate-700'
                }`}
              >
                {placeholder}
              </button>
            </li>
            {filtered.length === 0 && (
              <li className="px-3 py-1.5 text-sm text-slate-500">No matches</li>
            )}
            {filtered.map((option, i) => {
              const rowIndex = i + 1;
              const selected = option === value;
              return (
                <li key={option}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(rowIndex)}
                    onClick={() => select(option)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                      rowIndex === activeIndex ? 'bg-slate-700' : 'hover:bg-slate-700'
                    } ${selected ? 'text-white' : 'text-slate-100'}`}
                  >
                    <span>{option}</span>
                    {selected && <span className="ml-2 text-blue-400">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
