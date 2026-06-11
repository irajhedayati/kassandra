/**
 * Page-size selector + Next/Reset buttons for the data grid.
 * Cassandra paging is forward-only, so there's no explicit "Previous"
 * — Reset clears the paging state to start from the first page.
 */
interface Props {
  pageSize: number;
  pageSizes: ReadonlyArray<number>;
  onPageSizeChange: (size: number) => void;
  hasMorePages: boolean;
  canReset: boolean;
  onNext: () => void;
  onReset: () => void;
  loading: boolean;
  rowCount: number;
}

export function PaginationBar(props: Props) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <label htmlFor="page-size" className="text-slate-600">
          Rows per page
        </label>
        <select
          id="page-size"
          value={props.pageSize}
          onChange={(e) => props.onPageSizeChange(Number(e.target.value))}
          disabled={props.loading}
          className="rounded border border-slate-300 bg-white px-2 py-1"
        >
          {props.pageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span className="ml-3 text-slate-500">
          {props.rowCount} row{props.rowCount === 1 ? '' : 's'} on this page
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onReset}
          disabled={!props.canReset || props.loading}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={props.onNext}
          disabled={!props.hasMorePages || props.loading}
          className="rounded border border-blue-600 bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next page
        </button>
      </div>
    </div>
  );
}
