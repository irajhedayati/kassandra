/**
 * Schema-driven INSERT form. Renders a field per column using DynamicForm.
 *
 * Owned by the forms lane.
 */
interface Props {
  keyspace: string;
  table: string;
}

export function InsertForm(_props: Props) {
  return <div className="text-sm text-slate-500">InsertForm — not implemented</div>;
}
