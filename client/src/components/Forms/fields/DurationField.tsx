import {
  fieldLabel,
  inputClass,
  labelClass,
  type FieldProps,
} from './index.js';

/**
 * CQL `duration` value, e.g. `12h30m`, `P1Y2M3DT4H` (ISO-8601), or
 * `1mo2d`. The server converts via cassandra-driver's Duration helpers.
 */
export function DurationField(props: FieldProps) {
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
        placeholder={placeholder ?? 'e.g. 12h30m'}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
