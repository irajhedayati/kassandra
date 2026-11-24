import { describe, expect, it } from 'vitest';
import { findReadOnlyViolation, isReadOnlyCommand, readOnlyMessage } from './read-only.js';

const refused = (cql: string) => findReadOnlyViolation(cql)?.statement.command ?? null;

describe('read-only statement filter', () => {
  it('allows SELECT and USE in any case', () => {
    for (const cql of ['SELECT * FROM ks.t', 'select a from t where k = 1', 'Select JSON * FROM t', 'USE ks', 'use "Ks"']) {
      expect(findReadOnlyViolation(cql)).toBeNull();
    }
    expect(isReadOnlyCommand('select')).toBe(true);
  });

  it('allows several reads in one request', () => {
    expect(findReadOnlyViolation('USE ks; SELECT * FROM t; SELECT count(*) FROM u;')).toBeNull();
  });

  it('allows empty and comment-only input', () => {
    expect(findReadOnlyViolation('')).toBeNull();
    expect(findReadOnlyViolation('  -- nothing here\n /* or here */ ')).toBeNull();
  });

  it('refuses writes', () => {
    expect(refused('INSERT INTO t (k) VALUES (1)')).toBe('INSERT');
    expect(refused('update t set v = 1 where k = 1')).toBe('UPDATE');
    expect(refused('DELETE FROM t WHERE k = 1')).toBe('DELETE');
    expect(refused("INSERT INTO t (k) VALUES (1) IF NOT EXISTS")).toBe('INSERT');
  });

  it('refuses schema and permission changes', () => {
    for (const [cql, command] of [
      ['CREATE TABLE t (k int PRIMARY KEY)', 'CREATE'],
      ['ALTER TABLE t ADD v text', 'ALTER'],
      ['DROP KEYSPACE ks', 'DROP'],
      ['TRUNCATE t', 'TRUNCATE'],
      ['GRANT SELECT ON ks.t TO r', 'GRANT'],
      ['REVOKE SELECT ON ks.t FROM r', 'REVOKE'],
      ["CREATE ROLE r WITH PASSWORD = 'p'", 'CREATE'],
    ] as const) {
      expect(refused(cql)).toBe(command);
    }
  });

  it('refuses every kind of batch, even one that names SELECT', () => {
    expect(refused('BEGIN BATCH INSERT INTO t (k) VALUES (1); INSERT INTO t (k) VALUES (2); APPLY BATCH')).toBe('BATCH');
    expect(refused('begin unlogged batch update t set v = 1 where k = 1; apply batch')).toBe('BATCH');
    expect(refused('BEGIN COUNTER BATCH UPDATE c SET n = n + 1 WHERE k = 1; APPLY BATCH')).toBe('BATCH');
    expect(refused("BEGIN BATCH INSERT INTO t (k, v) VALUES (1, 'SELECT'); APPLY BATCH")).toBe('BATCH');
  });

  it('refuses commands it does not know (deny by default)', () => {
    expect(refused('LIST ROLES')).toBe('LIST');
    expect(refused('DESCRIBE KEYSPACES')).toBe('DESCRIBE');
    expect(refused('FROBNICATE everything')).toBe('FROBNICATE');
  });

  it('finds a write after reads, and names its position', () => {
    const v = findReadOnlyViolation('SELECT * FROM t; DROP TABLE t; SELECT * FROM u');
    expect(v?.statement.command).toBe('DROP');
    expect(v?.statement.index).toBe(2);
    expect(v?.message).toContain('DROP (statement #2) is not allowed');
  });

  it('is not fooled by comments or literals that look like reads', () => {
    expect(refused('/* SELECT */ DROP TABLE t')).toBe('DROP');
    expect(refused('-- SELECT\nDELETE FROM t WHERE k = 1')).toBe('DELETE');
    expect(refused("INSERT INTO t (k, v) VALUES (1, 'SELECT * FROM t')")).toBe('INSERT');
    expect(refused("SELECT * FROM t WHERE k = 'x'; INSERT INTO t (k) VALUES ('y')")).toBe('INSERT');
  });

  it('does not let a semicolon inside a literal hide a write', () => {
    expect(refused("SELECT * FROM t WHERE v = 'a;b'; UPDATE t SET v = 'c' WHERE k = 1")).toBe('UPDATE');
  });

  it('explains the refusal', () => {
    expect(findReadOnlyViolation('TRUNCATE t')?.message).toBe(
      'This connection profile is read-only: TRUNCATE is not allowed. Only SELECT and USE statements can run.',
    );
    expect(readOnlyMessage()).toBe('This connection profile is read-only.');
  });
});
