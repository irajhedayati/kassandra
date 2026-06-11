import {
  fieldLabel,
  labelClass,
  textareaClass,
  type FieldProps,
} from './index.js';

/**
 * Editor for `list<...>` / `set<...>` / `tuple<...>` columns. The user
 * types JSON; DynamicForm validates `JSON.parse` on submit.
 */
export function ListField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder } = props;
  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <textarea
        className={textareaClass}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? 'JSON array: ["a", "b"]'}
        spellCheck={false}
      />
    </label>
  );
}
