import {
  fieldLabel,
  inputClass,
  labelClass,
  type FieldProps,
} from './index.js';

/**
 * UUID / TIMEUUID input. Empty value means the server should auto-generate
 * a fresh UUID on insert.
 */
export function UuidField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder } = props;
  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <input
        type="text"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? 'UUID (auto-generated if empty)'}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
