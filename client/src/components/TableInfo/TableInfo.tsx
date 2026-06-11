/**
 * Table info panel: schema readout (column name, type, key kind, hide,
 * map-schema editor for map columns).
 *
 * Owned by the metadata/info lane.
 */
interface Props {
  keyspace: string;
  table: string;
}

export function TableInfo(_props: Props) {
  return <div className="text-sm text-slate-500">TableInfo — not implemented</div>;
}
