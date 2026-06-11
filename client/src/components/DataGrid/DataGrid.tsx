/**
 * Paginated data grid for a Cassandra table. Column filters, page-size
 * selector, paging-state navigation. Row click → detail drawer with
 * edit/delete actions.
 *
 * Owned by the data lane.
 */
interface Props {
  keyspace: string;
  table: string;
}

export function DataGrid(_props: Props) {
  return <div className="text-sm text-slate-500">DataGrid — not implemented</div>;
}
