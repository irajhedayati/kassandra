/**
 * Button + listbox dropdown where each option has a label and an optional
 * helper line. Used for enum-like choices (grid filter operators, replication
 * strategy, column types). Pass `searchable` for long lists.
 *
 * The list is rendered in a portal with fixed positioning so scrolling or
 * overflow-hidden ancestors (tables, dialogs) can't clip it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  helperText?: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Show a search box that filters the options (by label, value and helper text). */
  searchable?: boolean;
  /** Tailwind width class for the trigger button. */
  buttonClassName?: string;
  /**
   * Tailwind width class for the option list. The list is never narrower than
   * the button; use `w-auto` to size it to its content.
   */
  listClassName?: string;
}

export function OptionDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  searchable,
  buttonClassName = 'w-40',
  listClassName = 'w-72',
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLUListElement>(null);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(needle) ||
          o.value.toLowerCase().includes(needle) ||
          (o.helperText ?? '').toLowerCase().includes(needle),
      )
    : options;

  function close() {
    setOpen(false);
    setFilter('');
  }

  function choose(v: T) {
    onChange(v);
    close();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    const idx = options.findIndex((o) => o.value === value);
    setActive(Math.max(idx, 0));
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const listHeight = listRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    const fitsBelow = below + listHeight <= window.innerHeight - 8;
    const top = fitsBelow || rect.top - 4 - listHeight < 8 ? below : rect.top - 4 - listHeight;
    setPos({ left: rect.left, top, minWidth: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
    }
    // A fixed-position list would drift from its button, so close on scroll/resize.
    function onScroll(e: Event) {
      if (listRef.current?.contains(e.target as Node)) return;
      close();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (itemsRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({
      block: 'nearest',
    });
  }, [active, open]);

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = visible[active];
      if (o) choose(o.value);
    }
  }

  const selected = options.find((o) => o.value === value) ?? options[0]!;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        className={`flex items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${buttonClassName}`}
      >
        <span className={`truncate ${selected.value === '' ? 'text-slate-400' : ''}`}>
          {selected.label}
        </span>
        <span className="text-slate-400">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            style={{
              position: 'fixed',
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              minWidth: pos?.minWidth,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={`z-[70] rounded border border-slate-300 bg-white text-sm shadow-lg ${listClassName}`}
          >
            {searchable && (
              <input
                autoFocus
                type="text"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search…"
                aria-label={`Search ${label}`}
                className="w-full rounded-t border-b border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none"
              />
            )}
            <ul ref={itemsRef} role="listbox" className="max-h-64 overflow-y-auto">
              {visible.length === 0 && <li className="px-3 py-2 text-slate-400">No matches</li>}
              {visible.map((o, idx) => (
                <li key={o.value} role="option" aria-selected={o.value === value}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(o.value)}
                    className={`block w-full px-3 py-2 text-left ${
                      idx === active ? 'bg-slate-50' : ''
                    } ${o.value === value ? 'bg-blue-50' : ''}`}
                  >
                    <span className="block font-medium text-slate-900">{o.label}</span>
                    {o.helperText && (
                      <span className="block text-xs text-slate-500">{o.helperText}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
