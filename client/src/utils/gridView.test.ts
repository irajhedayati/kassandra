import { describe, expect, it } from 'vitest';
import type { Row } from '@kassandra/shared';
import { applyGridView } from './gridView.js';

const rows: Row[] = [
  { id: 'a', n: 10, big: '9007199254740993', tags: { k: 'x' } },
  { id: 'B', n: 2, big: '100', tags: null },
  { id: 'c', n: null, big: '5', tags: { k: 'y' } },
];
const ids = (r: Row[]) => r.map((x) => x.id);

describe('applyGridView', () => {
  it('returns rows unchanged with no filter or sort', () => {
    expect(applyGridView(rows, {}, null)).toBe(rows);
  });

  it('filters case-insensitively by substring, ANDing columns', () => {
    expect(ids(applyGridView(rows, { id: 'b' }, null))).toEqual(['B']);
    expect(ids(applyGridView(rows, { tags: '"k":"y"' }, null))).toEqual(['c']);
    expect(ids(applyGridView(rows, { id: 'b', n: '10' }, null))).toEqual([]);
    expect(ids(applyGridView(rows, { id: '  ' }, null))).toEqual(['a', 'B', 'c']);
  });

  it('sorts numbers numerically with nulls last in both directions', () => {
    expect(ids(applyGridView(rows, {}, { column: 'n', direction: 'asc' }))).toEqual(['B', 'a', 'c']);
    expect(ids(applyGridView(rows, {}, { column: 'n', direction: 'desc' }))).toEqual(['a', 'B', 'c']);
  });

  it('sorts numeric strings numerically and text case-insensitively', () => {
    expect(ids(applyGridView(rows, {}, { column: 'big', direction: 'asc' }))).toEqual(['c', 'B', 'a']);
    expect(ids(applyGridView(rows, {}, { column: 'id', direction: 'asc' }))).toEqual(['a', 'B', 'c']);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    applyGridView(rows, {}, { column: 'n', direction: 'desc' });
    expect(rows).toEqual(copy);
  });
});
