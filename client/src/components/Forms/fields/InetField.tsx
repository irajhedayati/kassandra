import {
  fieldLabel,
  inputClass,
  labelClass,
  type FieldProps,
} from './index.js';

/** IPv4/IPv6 string input. Server validates the format. */
export function InetField(props: FieldProps) {
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
        placeholder={placeholder ?? 'IP address'}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
