import { describe, expect, it } from 'vitest';
import {
  getTypeInfo,
  isStringStringMap,
  mapKeyValueTypes,
  rootCqlType,
} from './cql-types.js';

describe('rootCqlType', () => {
  it('returns the type unchanged when there are no generics', () => {
    expect(rootCqlType('text')).toBe('text');
  });

  it('strips generic parameters', () => {
    expect(rootCqlType('list<text>')).toBe('list');
    expect(rootCqlType('map<text, int>')).toBe('map');
  });

  it('handles frozen wrappers', () => {
    expect(rootCqlType('frozen<map<text, int>>')).toBe('frozen');
  });

  it('lowercases and trims the result', () => {
    expect(rootCqlType('  TEXT  ')).toBe('text');
    expect(rootCqlType('LIST<text>')).toBe('list');
  });
});

describe('getTypeInfo', () => {
  it('maps known root types to their widget', () => {
    expect(getTypeInfo('text').widget).toBe('textarea');
    expect(getTypeInfo('int').widget).toBe('number_int');
    expect(getTypeInfo('map<text, text>').widget).toBe('map');
  });

  it('falls back to a text widget for unknown types', () => {
    expect(getTypeInfo('some_udt')).toEqual({ widget: 'text' });
  });
});

describe('mapKeyValueTypes', () => {
  it('extracts key/value types from a map', () => {
    expect(mapKeyValueTypes('map<text, text>')).toEqual({
      keyType: 'text',
      valueType: 'text',
    });
  });

  it('unwraps a frozen map', () => {
    expect(mapKeyValueTypes('frozen<map<text, int>>')).toEqual({
      keyType: 'text',
      valueType: 'int',
    });
  });

  it('trims whitespace around parameters', () => {
    expect(mapKeyValueTypes('map<  text ,  bigint  >')).toEqual({
      keyType: 'text',
      valueType: 'bigint',
    });
  });

  it('returns null for non-map types', () => {
    expect(mapKeyValueTypes('list<text>')).toBeNull();
    expect(mapKeyValueTypes('text')).toBeNull();
  });

  it('returns null for malformed generics', () => {
    expect(mapKeyValueTypes('map<text>')).toBeNull();
  });
});

describe('isStringStringMap', () => {
  it('is true when both key and value are string-like', () => {
    expect(isStringStringMap('map<text, text>')).toBe(true);
    expect(isStringStringMap('map<varchar, ascii>')).toBe(true);
    expect(isStringStringMap('frozen<map<text, text>>')).toBe(true);
  });

  it('is false when either side is not string-like', () => {
    expect(isStringStringMap('map<text, int>')).toBe(false);
    expect(isStringStringMap('map<uuid, text>')).toBe(false);
  });

  it('is false for non-map types', () => {
    expect(isStringStringMap('list<text>')).toBe(false);
  });
});
