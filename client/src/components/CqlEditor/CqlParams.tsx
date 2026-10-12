/**
 * Inputs for the `:name` parameters detected in the editor's query: one row
 * per distinct name with a type selector and a value box.
 */
import { PARAM_TYPES } from '@kassandra/shared';

interface Props {
  names: string[];
  types: Record<string, string>;
  values: Record<string, string>;
  onTypeChange: (name: string, type: string) => void;
  onValueChange: (name: string, value: string) => void;
  onSubmit: () => void;
}

const inputClass =
  'rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export function CqlParams({ names, types, values, onTypeChange, onValueChange, onSubmit }: Props) {
  if (names.length === 0) return null;
  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3" data-testid="cql-params">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Parameters</p>
      {names.map((name) => (
        <div key={name} className="flex items-center gap-2">
          <label className="w-40 truncate font-mono text-sm text-slate-700" title={`:${name}`}>
            :{name}
          </label>
          <select
            aria-label={`Type of :${name}`}
            className={inputClass}
            value={types[name] ?? 'text'}
            onChange={(e) => onTypeChange(name, e.target.value)}
          >
            {PARAM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            aria-label={`Value of :${name}`}
            className={`${inputClass} flex-1`}
            value={values[name] ?? ''}
            onChange={(e) => onValueChange(name, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
            placeholder="value"
          />
        </div>
      ))}
    </div>
  );
}
