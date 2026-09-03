import { fieldLabel, labelClass, inputClass, type FieldProps } from './index.js';

interface EnumFieldProps extends FieldProps {
  enumValues: string[];
}

/** Dropdown for `text` columns marked `display_type: 'enum'` with user-defined values. */
export function EnumField(props: EnumFieldProps) {
  const { column, value, onChange, disabled, enumValues } = props;
  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">-- select --</option>
        {enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
