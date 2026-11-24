/**
 * Stand-in for `@monaco-editor/react`, which needs a real browser (workers,
 * layout) and loads Monaco from a CDN. A test file that renders the CQL editor
 * or a JSON field opts in with:
 *
 *   vi.mock('@monaco-editor/react', () => import('../test/monaco.js'));
 *
 * (`vi.mock` must be written in the test file itself, where Vitest hoists it
 * above the imports.) The editor becomes a `<textarea>` labelled "Code editor":
 * type into it with user-event and the component's `onChange` gets the text.
 * `onMount` receives stand-ins for the editor and the `monaco` namespace whose
 * every method is a no-op, so code that registers commands or completion
 * providers runs unchanged.
 */
import { useEffect, type ChangeEvent } from 'react';

/** An object whose every property is itself, callable, and 0 as a number; `then` is absent so it is never awaited. */
function noop(): unknown {
  const target = function () {};
  const proxy: unknown = new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => 0;
      return proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

interface EditorProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string | undefined, event: unknown) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
  options?: { readOnly?: boolean };
}

export default function Editor({ value, defaultValue, onChange, onMount, options }: EditorProps) {
  useEffect(() => {
    onMount?.(noop(), noop());
  }, []); // mounted once, like the real editor
  return (
    <textarea
      aria-label="Code editor"
      value={value ?? defaultValue ?? ''}
      readOnly={options?.readOnly}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value, e)}
    />
  );
}

export const DiffEditor = Editor;
export const loader = { config: () => {}, init: () => Promise.resolve(noop()) };
export const useMonaco = () => null;
