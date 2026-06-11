import {
  fieldLabel,
  inputClass,
  labelClass,
  type FieldProps,
} from './index.js';

/**
 * datetime-local field. Stores `YYYY-MM-DDTHH:mm[:ss]` (no timezone).
 * Server interprets as ISO. Empty string is allowed.
 */
export function DatetimeField(props: FieldProps) {
  const { column, value, onChange, disabled } = props;

  // datetime-local widgets do not accept a trailing "Z" — strip it if
  // an ISO Zulu string was passed in.
  const normalized = value.endsWith('Z') ? value.slice(0, -1) : value;

  return (
    <label className="block">
      <span className={labelClass}>{fieldLabel(column)}</span>
      <input
        type="datetime-local"
        step="1"
        className={inputClass}
        value={normalized}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
