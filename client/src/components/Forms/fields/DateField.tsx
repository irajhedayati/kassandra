import {
  fieldLabel,
  inputClass,
  labelClass,
  type FieldProps,
} from './index.js';

/** HTML5 date input. Stored as ISO yyyy-mm-dd. */
export function DateField(props: FieldProps) {
  const { column, value, onChange, disabled } = props;
  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <input
        type="date"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
