import type { CqlValue, Row } from '@kassandra/shared';

/**
 * Client-side sort/filter over the rows already loaded in the Data Browser.
 * Never touches the server or paging state.
 */

export interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

/** Text used for both matching and display-independent comparison. */
export function cellText(value: CqlValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function compareValues(a: CqlValue | undefined, b: CqlValue | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const sa = cellText(a);
  const sb = cellText(b);
  // bigint/decimal/varint arrive as strings; compare them numerically.
  if (NUMERIC.test(sa) && NUMERIC.test(sb)) {
    const diff = Number(sa) - Number(sb);
    if (diff !== 0) return diff;
  }
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

const isNull = (v: CqlValue | undefined) => v === null || v === undefined;

/**
 * @param filters column → case-insensitive "contains" text; blank entries ignored.
 */
export function applyGridView(
  rows: Row[],
  filters: Record<string, string>,
  sort: SortState | null,
): Row[] {
  const active = Object.entries(filters)
    .map(([col, text]) => [col, text.trim().toLowerCase()] as const)
    .filter(([, text]) => text !== '');

  let out = rows;
  if (active.length > 0) {
    out = rows.filter((row) =>
      active.every(([col, text]) => cellText(row[col]).toLowerCase().includes(text)),
    );
  }

  if (sort) {
    const dir = sort.direction === 'asc' ? 1 : -1;
    // Array.prototype.sort is stable, so ties keep their loaded order.
    out = [...out].sort((ra, rb) => {
      const a = ra[sort.column];
      const b = rb[sort.column];
      // Nulls always sort last regardless of direction.
      if (isNull(a) || isNull(b)) return isNull(a) === isNull(b) ? 0 : isNull(a) ? 1 : -1;
      return dir * compareValues(a, b);
    });
  }
  return out;
}
