import { describe, expect, it } from 'vitest';
import { extractParamNames, toPositional } from './saved-query.js';

describe('extractParamNames', () => {
  it('finds distinct names in order', () => {
    expect(extractParamNames('SELECT * FROM t WHERE a = :a AND b = :b OR c = :a')).toEqual(['a', 'b']);
  });

  it('ignores literals, quoted identifiers and comments', () => {
    const q = `SELECT ':no', "col:x" FROM t -- :c1\nWHERE a = :yes /* :c2 */ AND b = $$:no2$$ // :c3`;
    expect(extractParamNames(q)).toEqual(['yes']);
  });

  it('handles doubled quotes inside strings', () => {
    expect(extractParamNames(`SELECT 'it''s :no' FROM t WHERE a = :a`)).toEqual(['a']);
  });
});

describe('toPositional', () => {
  it('replaces each occurrence with ? and keeps bind order', () => {
    expect(toPositional('SELECT * FROM t WHERE a = :a AND b = :b AND c = :a')).toEqual({
      cql: 'SELECT * FROM t WHERE a = ? AND b = ? AND c = ?',
      order: ['a', 'b', 'a'],
    });
  });
});
