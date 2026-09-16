import { describe, expect, it } from 'vitest';
import { formatValueForDisplay, formatValueForEdit } from './format.js';

describe('formatValueForDisplay', () => {
  it('renders null/undefined as an empty string', () => {
    expect(formatValueForDisplay(null, 'text')).toBe('');
    expect(formatValueForDisplay(undefined, 'text')).toBe('');
  });

  it('pretty-prints maps', () => {
    expect(formatValueForDisplay({ a: '1' }, 'map<text, text>')).toBe(
      JSON.stringify({ a: '1' }, null, 2),
    );
  });

  it('compact-prints lists and sets', () => {
    expect(formatValueForDisplay(['a', 'b'], 'list<text>')).toBe('["a","b"]');
    expect(formatValueForDisplay(['a', 'b'], 'set<text>')).toBe('["a","b"]');
  });

  it('renders blobs as hex from a Uint8Array', () => {
    expect(formatValueForDisplay(new Uint8Array([0xde, 0xad]), 'blob')).toBe('dead');
  });

  it('renders blobs as hex from a Node Buffer JSON shape', () => {
    expect(formatValueForDisplay({ type: 'Buffer', data: [0xde, 0xad] }, 'blob')).toBe(
      'dead',
    );
  });

  it('renders timestamps as ISO strings', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    expect(formatValueForDisplay(date, 'timestamp')).toBe(date.toISOString());
  });

  it('renders booleans as the literal string', () => {
    expect(formatValueForDisplay(true, 'boolean')).toBe('true');
    expect(formatValueForDisplay(false, 'boolean')).toBe('false');
  });
});

describe('formatValueForEdit', () => {
  it('keeps text values raw, unlike formatValueForDisplay', () => {
    expect(formatValueForEdit('hello "world"', 'text')).toBe('hello "world"');
  });

  it('falls back to formatValueForDisplay for non-text types', () => {
    expect(formatValueForEdit({ a: '1' }, 'map<text, text>')).toBe(
      formatValueForDisplay({ a: '1' }, 'map<text, text>'),
    );
  });

  it('renders null/undefined as an empty string', () => {
    expect(formatValueForEdit(null, 'text')).toBe('');
  });
});
