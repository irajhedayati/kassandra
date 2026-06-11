import { fieldLabel, type FieldProps } from './index.js';

export function CheckboxField(props: FieldProps) {
  const { column, value, onChange, disabled } = props;
  const checked = value === 'true' || value === '1';

  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        disabled={disabled}
      />
      <span className="text-sm font-medium text-slate-700">
        {fieldLabel(column)}
      </span>
    </label>
  );
}
