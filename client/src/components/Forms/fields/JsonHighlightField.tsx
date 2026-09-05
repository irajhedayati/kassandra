import { useCallback, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { fieldLabel, labelClass, type FieldProps } from './index.js';

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 500;

/**
 * Monaco-based JSON editor/viewer for `text` columns whose column metadata
 * marks them as `display_type: 'JSON'`. Height grows with content up to
 * MAX_HEIGHT, after which the editor scrolls internally.
 */
export function JsonHighlightField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder } = props;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const applyHeight = useCallback(() => {
    const editor = editorRef.current;
    const container = containerRef.current;
    if (!editor || !container) return;
    const contentHeight = editor.getContentHeight();
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight));
    container.style.height = `${next}px`;
    editor.layout();
  }, []);

  const handleMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      applyHeight();
      editor.onDidContentSizeChange(applyHeight);
    },
    [applyHeight],
  );

  let displayValue = value;
  try {
    if (value.trim()) displayValue = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // leave as-is — invalid/partial JSON while typing
  }

  return (
    <div>
      <span className={labelClass}>{fieldLabel(column)}</span>
      <div
        ref={containerRef}
        className="overflow-hidden rounded border border-slate-300"
        style={{ height: MIN_HEIGHT }}
      >
        <Editor
          height="100%"
          defaultLanguage="json"
          language="json"
          theme="vs-light"
          value={displayValue}
          onChange={(v: string | undefined) => onChange(v ?? '')}
          onMount={handleMount}
          options={{
            readOnly: disabled,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            lineNumbers: 'off',
            folding: true,
            placeholder,
          }}
        />
      </div>
    </div>
  );
}
