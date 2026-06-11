import {
  fieldLabel,
  inputClass,
  labelClass,
  textareaClass,
  type FieldProps,
} from './index.js';
import { rootCqlType } from '@py-sandra/shared';

/**
 * Generic text input. Used for ascii / decimal / varchar (single-line) and
 * defaults for any unknown root type. text/varchar render as a textarea.
 */
export function TextField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder } = props;
  const root = rootCqlType(column.cql_type);
  const multiline = root === 'text' || root === 'varchar';

  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      {multiline ? (
        <textarea
          className={textareaClass}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
        />
      ) : (
        <input
          type="text"
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}
