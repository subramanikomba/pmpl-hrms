/**
 * The opt-in that brings former employees into a report.
 *
 * Dormant by design: it renders nothing at all when there are no inactive
 * employees to include, so a company that has never had a leaver never sees
 * it. When it does appear it is deliberately quiet — small, muted, and
 * off — because the common case is a report about current staff.
 */
export function IncludeInactive(
  { checked, onChange, count }:
  { checked: boolean; onChange: (v: boolean) => void; count: number },
) {
  if (count === 0) return null;
  return (
    <label className={`include-inactive ${checked ? 'is-on' : ''}`}>
      <input type="checkbox" checked={checked}
        onChange={(e) => onChange(e.target.checked)} />
      Include inactive employees
      {!checked && <span className="include-inactive-count">{count}</span>}
    </label>
  );
}
