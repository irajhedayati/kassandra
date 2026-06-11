import {
  fieldLabel,
  labelClass,
  textareaClass,
  type FieldProps,
} from './index.js';

/**
 * Simple JSON-object editor for `map<...>` columns. The richer
 * map-schema-aware editor (Lane F) lives elsewhere; this is the
 * fallback used when no `map_schema` metadata is configured.
 */
export function MapField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder } = props;
  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <textarea
        className={textareaClass}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? 'JSON object: {"key": "value"}'}
        spellCheck={false}
      />
    </label>
  );
}
