import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer — returns React nodes, so values are escaped by React. */
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /**
   * Makes the column sortable. Returns the value to sort on, which is often
   * not what the cell displays — a date cell shows "05 Aug 2026" but must
   * sort on the ISO date, and an amount must sort as a number, not a string.
   * Omit to leave the column unsortable.
   */
  sortValue?: (row: T) => string | number | null | undefined;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function DataTable<T>(
  { columns, rows, rowKey, rowClassName, empty = 'No records found.', footer }:
  { columns: Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string;
    /** Optional per-row class, for highlighting an exceptional row. */
    rowClassName?: (row: T) => string;
    empty?: ReactNode; footer?: ReactNode },
) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const sortValue = col?.sortValue;
    if (!sortValue) return rows;

    // Copy first: never sort the caller's array in place.
    return [...rows].sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);

      // Blanks always sort last, whichever direction is chosen, so an empty
      // cell never displaces real data at the top of the table.
      const aEmpty = va === null || va === undefined || va === '';
      const bEmpty = vb === null || vb === undefined || vb === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true });

      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  /** First click sorts ascending; clicking the same column again reverses. */
  function toggle(key: string) {
    setSort((s) => s && s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const style = { textAlign: c.align ?? 'left', width: c.width } as const;
              if (!c.sortValue) {
                return <th key={c.key} style={style}>{c.header}</th>;
              }
              return (
                <th
                  key={c.key}
                  style={style}
                  aria-sort={active
                    ? (sort?.dir === 'asc' ? 'ascending' : 'descending')
                    : 'none'}
                >
                  <button
                    type="button"
                    className={`th-sort ${active ? 'is-active' : ''}`}
                    onClick={() => toggle(c.key)}
                  >
                    {c.header}
                    <span className="th-arrow" aria-hidden="true">
                      {active ? (sort?.dir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">{empty}</td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row) || undefined}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
