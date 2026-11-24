/**
 * What a read-only connection profile may run (see `ConnectionProfile.read_only`).
 *
 * The rule is an allow-list: a statement may run only if its command, the
 * first keyword as classified by `splitCqlStatements`, is listed here. Anything
 * else is refused, including statements this module doesn't recognize, so new
 * CQL commands are denied by default. `BEGIN [UNLOGGED|COUNTER] BATCH ... APPLY
 * BATCH` is classified as BATCH, and a batch only holds writes, so it is refused
 * as a whole. Every LIST command (LIST ROLES, LIST USERS, LIST PERMISSIONS,
 * LIST <permission> ON ... OF ...) only reads roles and permissions.
 */
import { splitCqlStatements, type CqlStatement } from './cql-statements.js';

/** Commands allowed while connected with a read-only profile. */
export const READ_ONLY_COMMANDS: readonly string[] = ['SELECT', 'USE', 'LIST'];

export function isReadOnlyCommand(command: string): boolean {
  return READ_ONLY_COMMANDS.includes(command.toUpperCase());
}

export interface ReadOnlyViolation {
  statement: CqlStatement;
  /** Refusal message naming the statement. */
  message: string;
}

/** First statement in `cql` that a read-only profile may not run, or null when every statement is allowed. */
export function findReadOnlyViolation(cql: string): ReadOnlyViolation | null {
  const statements = splitCqlStatements(cql);
  const statement = statements.find((s) => !isReadOnlyCommand(s.command));
  if (!statement) return null;
  const what = statement.command || 'this statement';
  // The CQL editor sends one statement per request; only name the position when there are several.
  const where = statements.length > 1 ? ` (statement #${statement.index})` : '';
  return { statement, message: readOnlyMessage(`${what}${where}`) };
}

/**
 * Refusal message. `what` names the refused statement or action (`INSERT`,
 * `Deleting rows`); without it the message is just that the profile is read-only.
 */
export function readOnlyMessage(what?: string): string {
  const base = 'This connection profile is read-only';
  if (!what) return `${base}.`;
  const allowed = `${READ_ONLY_COMMANDS.slice(0, -1).join(', ')} and ${READ_ONLY_COMMANDS.at(-1)}`;
  return `${base}: ${what} is not allowed. Only ${allowed} statements can run.`;
}
