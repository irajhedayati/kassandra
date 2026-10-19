import { describe, expect, it } from 'vitest';
import type { QueryResult } from '@kassandra/shared';
import { describeSuccess } from './cqlReport.js';

const ok = (extra: Partial<QueryResult> = {}): QueryResult => ({
  success: true,
  rows: [],
  pagingState: null,
  hasMorePages: false,
  ...extra,
});

describe('describeSuccess', () => {
  it('reports SELECT row counts', () => {
    expect(describeSuccess('SELECT', ok({ rows: [{ a: 1 }] }))).toBe('1 row returned');
    expect(describeSuccess('SELECT', ok({ hasMorePages: true }))).toBe('0 rows returned (more pages available)');
  });

  it('reports INSERT and DELETE counts', () => {
    expect(describeSuccess('INSERT', ok({ affected: { count: 1, unit: 'row' } }))).toBe('1 row inserted');
    expect(describeSuccess('DELETE', ok({ affected: { count: 6, unit: 'cell' } }))).toBe('6 cells deleted');
    expect(describeSuccess('DELETE', ok())).toBe('Deleted');
  });

  it('flags unapplied lightweight transactions', () => {
    expect(describeSuccess('INSERT', ok({ applied: false }))).toBe('Not applied (condition not met)');
  });

  it('falls back to a generic message', () => {
    expect(describeSuccess('UPDATE', ok())).toBe('Succeeded');
  });
});
