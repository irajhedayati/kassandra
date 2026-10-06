import { OptionDropdown } from '../../OptionDropdown.js';
import { fieldLabel, labelClass, type FieldProps } from './index.js';

interface EnumFieldProps extends FieldProps {
  enumValues: string[];
}

/** Dropdown for `text` columns marked `display_type: 'enum'` with user-defined values. */
export function EnumField(props: EnumFieldProps) {
  const { column, value, onChange, disabled, enumValues } = props;
  // Keep a current value that isn't in the defined list selectable/visible.
  const values = value && !enumValues.includes(value) ? [value, ...enumValues] : enumValues;
  return (
    <div className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <OptionDropdown
        label={fieldLabel(column)}
        value={value}
        options={[
          { value: '', label: '-- select --' },
          ...values.map((v) => ({ value: v, label: v })),
        ]}
        onChange={onChange}
        disabled={disabled}
        buttonClassName="w-full px-2 py-1.5"
        listClassName="w-auto"
      />
    </div>
  );
}
