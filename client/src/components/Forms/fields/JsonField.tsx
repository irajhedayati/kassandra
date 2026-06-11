import { useEffect, useState } from 'react';
import {
  fieldLabel,
  labelClass,
  textareaClass,
  type FieldProps,
} from './index.js';

interface JsonFieldProps extends FieldProps {
  /**
   * If true, render as a read-only `<pre>` with formatted JSON. The map
   * column display-type override (PR2) uses this in the data grid.
   */
  readOnlyDisplay?: boolean;
}

/**
 * JSON value editor. On blur it pretty-prints valid JSON; invalid JSON is
 * left as-is so the user can fix typos. Submission validation happens in
 * DynamicForm.
 */
export function JsonField(props: JsonFieldProps) {
  const { column, value, onChange, disabled, placeholder, readOnlyDisplay } =
    props;
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(value);

  // Keep local draft in sync with parent-controlled value.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (readOnlyDisplay) {
    let formatted = value;
    try {
      formatted = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      // leave as-is
    }
    return (
      <div>
        <span className={labelClass}>{fieldLabel(column)}</span>
        <pre className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 overflow-auto">
          {formatted}
        </pre>
      </div>
    );
  }

  function handleBlur() {
    if (!draft.trim()) {
      setError(null);
      return;
    }
    try {
      const parsed = JSON.parse(draft);
      const pretty = JSON.stringify(parsed, null, 2);
      setDraft(pretty);
      onChange(pretty);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <textarea
        className={textareaClass}
        rows={4}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder ?? 'JSON'}
        spellCheck={false}
      />
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
