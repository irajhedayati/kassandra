import {
  fieldLabel,
  inputClass,
  labelClass,
  type FieldProps,
} from './index.js';
import { rootCqlType } from '@kassandra/shared';

/**
 * Numeric field. Uses step="1" for integer-rooted types and "any" for
 * floats / doubles. The internal state is still kept as a string so empty
 * values round-trip cleanly.
 */
export function NumberField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder } = props;
  const root = rootCqlType(column.cql_type);
  const isFloat = root === 'float' || root === 'double';

  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <input
        type="number"
        step={isFloat ? 'any' : '1'}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </label>
  );
}
