import type { QueryResult } from '@kassandra/shared';

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** One-line summary of a successful statement for the execution report. */
export function describeSuccess(command: string, res: QueryResult): string {
  if (res.applied === false) return 'Not applied (condition not met)';
  const { affected } = res;
  switch (command) {
    case 'SELECT':
      return `${plural(res.rows.length, 'row')} returned${res.hasMorePages ? ' (more pages available)' : ''}`;
    case 'INSERT':
      return affected ? `${plural(affected.count, affected.unit)} inserted` : 'Inserted';
    case 'DELETE':
      return affected ? `${plural(affected.count, affected.unit)} deleted` : 'Deleted';
    default:
      return 'Succeeded';
  }
}
