import {
  fieldLabel,
  labelClass,
  textareaClass,
  type FieldProps,
} from './index.js';

/**
 * Blob editor. Stores hex-encoded bytes as a string. The server converts
 * hex -> Buffer before binding to the driver.
 */
export function BlobHexField(props: FieldProps) {
  const { column, value, onChange, disabled, placeholder } = props;
  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <textarea
        className={textareaClass}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? 'Hex string'}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
