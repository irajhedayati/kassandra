/**
 * CREATE TABLE statement builder, shared so the client can preview exactly what
 * the server will execute. DDL cannot use bind markers for identifiers, so
 * names and types are validated strictly and quoted/escaped here.
 *
 * Reference: https://docs.datastax.com/en/cql-oss/3.3/cql/cql_reference/cqlCreateTable.html
 */
import type { CreateTableRequest } from './types/schema.js';

/** Thrown for invalid input; the server maps it to HTTP 400. */
export class CqlBuildError extends Error {}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const SCALAR_TYPES = new Set([
  'ascii', 'bigint', 'blob', 'boolean', 'counter', 'date', 'decimal', 'double',
  'duration', 'float', 'inet', 'int', 'smallint', 'text', 'time', 'timestamp',
  'timeuuid', 'tinyint', 'uuid', 'varchar', 'varint',
]);

export const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const quoteString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Split on top-level commas (ignoring those inside <...>). */
function splitTypeArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim());
}

/** Validate a CQL type string and return it normalised (lower-case, single spaces). */
export function normalizeCqlType(type: string): string {
  const t = type.trim().toLowerCase();
  if (SCALAR_TYPES.has(t)) return t;
  const m = /^(list|set|map|frozen|tuple)<(.+)>$/.exec(t);
  if (!m) throw new CqlBuildError(`Unknown CQL type "${type}"`);
  const kind = m[1]!;
  const args = splitTypeArgs(m[2]!).map(normalizeCqlType);
  const expected = kind === 'map' ? 2 : kind === 'tuple' ? args.length : 1;
  if (args.length !== expected || args.length === 0) {
    throw new CqlBuildError(`Wrong number of type parameters in "${type}"`);
  }
  return `${kind}<${args.join(', ')}>`;
}

const isCollection = (t: string): boolean => /^(list|set|map)</.test(t);

function nonNegativeInt(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new CqlBuildError(`${label} must be a whole number of 0 or more`);
  }
  return value;
}

export function buildCreateTableCql(req: CreateTableRequest): string {
  if (!IDENTIFIER.test(req.keyspace)) throw new CqlBuildError('Select a valid keyspace');
  if (!IDENTIFIER.test(req.name)) {
    throw new CqlBuildError(
      'Table name must start with a letter, contain only letters, digits and underscores, and be at most 48 characters',
    );
  }
  if (req.columns.length === 0) throw new CqlBuildError('Add at least one column');

  const seen = new Set<string>();
  const defs: string[] = [];
  const partition: string[] = [];
  const clustering: { name: string; order: 'ASC' | 'DESC' }[] = [];
  let hasCounter = false;
  let hasNonCounterRegular = false;

  for (const col of req.columns) {
    if (!IDENTIFIER.test(col.name)) {
      throw new CqlBuildError(
        `Column name "${col.name}" must start with a letter and contain only letters, digits and underscores`,
      );
    }
    const key = col.name.toLowerCase();
    if (seen.has(key)) throw new CqlBuildError(`Duplicate column "${col.name}"`);
    seen.add(key);

    const type = normalizeCqlType(col.type);
    const isKey = col.kind === 'partition_key' || col.kind === 'clustering';
    if (isKey && type === 'counter') {
      throw new CqlBuildError(`Key column "${col.name}" cannot be a counter`);
    }
    if (isKey && isCollection(type)) {
      throw new CqlBuildError(`Key column "${col.name}" must use a frozen collection`);
    }
    if (col.kind === 'static' && type === 'counter') {
      throw new CqlBuildError('Counter columns cannot be static');
    }
    if (type === 'counter') hasCounter = true;
    else if (!isKey) hasNonCounterRegular = true;

    if (col.kind === 'partition_key') partition.push(quoteIdent(col.name));
    if (col.kind === 'clustering') {
      clustering.push({ name: quoteIdent(col.name), order: col.order ?? 'ASC' });
    }
    defs.push(`${quoteIdent(col.name)} ${type}${col.kind === 'static' ? ' STATIC' : ''}`);
  }

  if (partition.length === 0) throw new CqlBuildError('Select at least one partition key column');
  if (hasCounter && hasNonCounterRegular) {
    throw new CqlBuildError('A table with counter columns cannot have other non-key columns');
  }
  if (clustering.length === 0 && req.columns.some((c) => c.kind === 'static')) {
    throw new CqlBuildError('Static columns require at least one clustering column');
  }

  const partitionSpec = partition.length === 1 ? partition[0]! : `(${partition.join(', ')})`;
  const pk = [partitionSpec, ...clustering.map((c) => c.name)].join(', ');
  defs.push(`PRIMARY KEY (${pk})`);

  const options: string[] = [];
  if (clustering.some((c) => c.order === 'DESC')) {
    options.push(
      `CLUSTERING ORDER BY (${clustering.map((c) => `${c.name} ${c.order}`).join(', ')})`,
    );
  }
  if (req.comment && req.comment.trim() !== '') options.push(`comment = ${quoteString(req.comment)}`);
  const ttl = nonNegativeInt(req.defaultTimeToLive, 'Default TTL');
  if (ttl !== undefined) options.push(`default_time_to_live = ${ttl}`);
  const gc = nonNegativeInt(req.gcGraceSeconds, 'GC grace seconds');
  if (gc !== undefined) options.push(`gc_grace_seconds = ${gc}`);
  if (req.compaction) {
    const known = [
      'SizeTieredCompactionStrategy',
      'LeveledCompactionStrategy',
      'TimeWindowCompactionStrategy',
    ];
    if (!known.includes(req.compaction)) throw new CqlBuildError('Unknown compaction strategy');
    options.push(`compaction = {'class': '${req.compaction}'}`);
  }
  if (req.compression) {
    if (req.compression === 'none') options.push(`compression = {'enabled': false}`);
    else if (['LZ4Compressor', 'SnappyCompressor', 'DeflateCompressor'].includes(req.compression)) {
      options.push(`compression = {'class': '${req.compression}'}`);
    } else throw new CqlBuildError('Unknown compression algorithm');
  }

  const head = `CREATE TABLE ${req.ifNotExists ? 'IF NOT EXISTS ' : ''}${quoteIdent(req.keyspace)}.${quoteIdent(req.name)}`;
  const body = `(\n  ${defs.join(',\n  ')}\n)`;
  return options.length > 0 ? `${head} ${body}\nWITH ${options.join('\n  AND ')}` : `${head} ${body}`;
}
