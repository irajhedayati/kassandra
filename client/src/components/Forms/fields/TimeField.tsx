import {
  fieldLabel,
  inputClass,
  labelClass,
  type FieldProps,
} from './index.js';

/** HTML5 time input. Stored as HH:mm[:ss]. */
export function TimeField(props: FieldProps) {
  const { column, value, onChange, disabled } = props;
  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <input
        type="time"
        step="1"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
