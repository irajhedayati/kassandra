import { useEffect, useRef, useState } from 'react';
import { getTypeInfo, primitiveListElementType, type WidgetKind } from '@kassandra/shared';
import { OptionDropdown } from '../../OptionDropdown.js';
import {
  fieldLabel,
  inputClass,
  labelClass,
  textareaClass,
  type FieldProps,
} from './index.js';

interface ListFieldProps extends FieldProps {
  /** Allowed values when the column's display type is `enum`; items are then picked from a dropdown. */
  enumValues?: string[];
}

interface Item {
  value: string;
  /** UI-only: added by the user and not edited yet; dropped on serialize so a blank row isn't written. */
  fresh?: boolean;
}

function parseItems(value: string): Item[] {
  if (!value || !value.trim()) return [];
  try {
    const arr: unknown = JSON.parse(value);
    if (Array.isArray(arr)) return arr.map((v) => ({ value: String(v ?? '') }));
  } catch {
    // unparsable; DynamicForm surfaces the JSON error on submit
  }
  return [];
}

/** Items are kept as strings; numbers and booleans are re-typed on the way out so the JSON stays valid for CQL. */
function serializeItems(items: Item[], widget: WidgetKind): string {
  const out: unknown[] = [];
  for (const { value, fresh } of items) {
    if (fresh && value === '') continue;
    if (widget === 'number_int' || widget === 'number_float') {
      const n = Number(value);
      if (value.trim() === '' || Number.isNaN(n)) continue;
      out.push(n);
    } else if (widget === 'checkbox') {
      out.push(value === 'true' || value === '1');
    } else {
      out.push(value);
    }
  }
  return JSON.stringify(out);
}

const ITEM_PLACEHOLDERS: Partial<Record<WidgetKind, string>> = {
  uuid: 'UUID',
  inet: 'IP address',
  duration: 'e.g. 12h30m',
  blob_hex: 'Hex string',
};

interface ItemInputProps {
  widget: WidgetKind;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean | undefined;
  label: string;
  enumValues: string[] | undefined;
}

function ItemInput({ widget, value, onChange, disabled, label, enumValues }: ItemInputProps) {
  if (enumValues) {
    return (
      <div className="flex-1">
        <OptionDropdown
          label={label}
          value={value}
          options={[
            { value: '', label: '-- select --' },
            // Keep a current value that isn't in the defined list visible.
            ...(value && !enumValues.includes(value) ? [value, ...enumValues] : enumValues).map((v) => ({
              value: v,
              label: v,
            })),
          ]}
          onChange={onChange}
          disabled={disabled}
          buttonClassName="w-full px-2 py-1.5"
          listClassName="w-auto"
        />
      </div>
    );
  }
  if (widget === 'checkbox') {
    return (
      <label className="flex flex-1 items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          checked={value === 'true' || value === '1'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span className="text-sm text-slate-600">{value || 'false'}</span>
      </label>
    );
  }
  const common = {
    className: `${inputClass} flex-1`,
    value,
    disabled,
    'aria-label': label,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  switch (widget) {
    case 'number_int':
    case 'number_float':
      return <input type="number" step={widget === 'number_float' ? 'any' : '1'} {...common} />;
    case 'date':
      return <input type="date" {...common} />;
    case 'time':
      return <input type="time" step="1" {...common} />;
    case 'datetime':
      return (
        <input
          type="datetime-local"
          step="1"
          {...common}
          value={value.endsWith('Z') ? value.slice(0, -1) : value}
        />
      );
    default:
      return (
        <input
          {...common}
          placeholder={ITEM_PLACEHOLDERS[widget] ?? 'value'}
        />
      );
  }
}

/**
 * Editor for `list<...>` columns. Lists of primitive types get one input per
 * item (a dropdown when `enumValues` is given) with "+ Add item" and a remove
 * button per item; everything else (sets, tuples, nested collections) falls
 * back to a raw JSON-array textarea. The form value stays a JSON array string.
 *
 * Items are kept in local state, like MapField, so in-progress blank rows
 * aren't lost by re-deriving them from the serialized value.
 */
export function ListField(props: ListFieldProps) {
  const { column, value, onChange, disabled, placeholder, enumValues } = props;

  const elementType = primitiveListElementType(column.cql_type);
  const widget = elementType ? getTypeInfo(elementType).widget : null;
  const [items, setItems] = useState<Item[]>(() => parseItems(value));
  const lastEmitted = useRef<string>(value);
  const initialValue = useRef<string>(value);

  useEffect(() => {
    // Resync only when the value changed for a reason other than our own onChange.
    if (value !== lastEmitted.current) {
      setItems(parseItems(value));
      lastEmitted.current = value;
    }
  }, [value]);

  if (!widget) {
    return (
      <label className="block">
        <span className={labelClass}>{fieldLabel(column)}</span>
        <textarea
          className={textareaClass}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? 'JSON array: ["a", "b"]'}
          spellCheck={false}
        />
      </label>
    );
  }

  function update(next: Item[]) {
    setItems(next);
    const serialized = serializeItems(next, widget!);
    // A list that started unset and is empty again stays '' so it isn't reported as changed / written as [].
    const emitted = serialized === '[]' && initialValue.current === '' ? '' : serialized;
    lastEmitted.current = emitted;
    onChange(emitted);
  }

  return (
    <div>
      <span className={labelClass}>{fieldLabel(column)}</span>
      <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
        {items.length === 0 && <p className="text-xs text-slate-400">No items.</p>}
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <ItemInput
              widget={widget}
              value={item.value}
              label={`${column.name} item ${i + 1}`}
              enumValues={enumValues}
              disabled={disabled}
              onChange={(v) => {
                const next = items.slice();
                next[i] = { value: v };
                update(next);
              }}
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => update(items.filter((_, j) => j !== i))}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Remove item"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() => update([...items, { value: '', fresh: true }])}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
          >
            + Add item
          </button>
        )}
      </div>
    </div>
  );
}
