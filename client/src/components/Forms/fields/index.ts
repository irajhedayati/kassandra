/**
 * Per-CQL-type field components.
 *
 * Each component accepts the same FieldProps shape so DynamicForm can
 * render them uniformly. The field renders its own label (with "[Partition
 * Key]" / "[Clustering Key]" suffix when applicable).
 */

import type { ColumnInfo } from '@py-sandra/shared';

export interface FieldProps {
  column: ColumnInfo;
  /** Stringified value (forms keep state as strings for round-tripping). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function fieldLabel(column: ColumnInfo): string {
  const base = `${column.name} (${column.cql_type})`;
  if (column.kind === 'partition_key') return `${base} [Partition Key]`;
  if (column.kind === 'clustering') return `${base} [Clustering Key]`;
  return base;
}

export const labelClass = 'block text-sm font-medium text-slate-700 mb-1';
export const inputClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ' +
  'disabled:bg-slate-100 disabled:text-slate-500';
export const textareaClass = `${inputClass} font-mono`;

export { TextField } from './TextField.js';
export { NumberField } from './NumberField.js';
export { CheckboxField } from './CheckboxField.js';
export { DateField } from './DateField.js';
export { TimeField } from './TimeField.js';
export { DatetimeField } from './DatetimeField.js';
export { UuidField } from './UuidField.js';
export { JsonField } from './JsonField.js';
export { ListField } from './ListField.js';
export { MapField } from './MapField.js';
export { BlobHexField } from './BlobHexField.js';
export { InetField } from './InetField.js';
export { DurationField } from './DurationField.js';
