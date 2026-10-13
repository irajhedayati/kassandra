import { useEffect, useRef } from 'react';

/**
 * While `active`, pressing Enter runs `onEnter` (the dialog's primary
 * OK/Confirm/Save action). Skipped where Enter already means something else:
 * textareas, buttons/links/selects (Enter clicks the focused control), and
 * anywhere inside a <form> (native submit handles it).
 */
export function useEnterToConfirm(active: boolean, onEnter: () => void): void {
  const ref = useRef(onEnter);
  ref.current = onEnter;

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        if (t.isContentEditable || t.closest('textarea, button, a, select, form, .monaco-editor')) {
          return;
        }
      }
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);
}
