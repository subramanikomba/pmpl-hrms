import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@/lib/useQuery';
import { clientApi, employeesApi, expenseApi, reimbursementApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { FilterIcon } from '@/components/ui/Icons';

type RangeKey =
  'today' | 'this_week' | 'this_month' | 'last_month' | 'this_fy' | 'custom';

/**
 * Presets in chronological order — each period starts earlier than the one
 * before it — with Custom last because it is not a period at all. Rendering the
 * dropdown from this list keeps the visible order and the key set in one place.
 */
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_fy', label: 'This financial year' },
  { key: 'custom', label: 'Custom' },
];

/** The range the screen opens on, and the one Reset returns to. */
const DEFAULT_RANGE: RangeKey = 'this_fy';

/**
 * First and last day of a preset range, or null for 'custom', which has no
 * computed span. Pure and date-injected so the initial state, the dropdown and
 * Reset all derive their dates from one place and cannot drift apart.
 */
function rangeDates(key: RangeKey, n: Date): [Date, Date] | null {
  if (key === 'custom') return null;
  if (key === 'today') return [n, n];
  if (key === 'this_week') {
    // Week starts Monday, matching the Mon-Sat working calendar.
    const dow = (n.getDay() + 6) % 7;
    const first = new Date(n.getFullYear(), n.getMonth(), n.getDate() - dow);
    return [first, new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6)];
  }
  if (key === 'this_fy') {
    // Indian financial year: 1 April to 31 March. Before April we are still in
    // the FY that began last calendar year.
    const fyStart = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
    return [new Date(fyStart, 3, 1), new Date(fyStart + 1, 2, 31)];
  }
  const off = key === 'last_month' ? -1 : 0;
  return [
    new Date(n.getFullYear(), n.getMonth() + off, 1),
    new Date(n.getFullYear(), n.getMonth() + off + 1, 0),
  ];
}

/**
 * Delays a value so typing into a date field does not fire a query per
 * keystroke. Used only for the custom From/To inputs: a preset sets both dates
 * at once and is applied immediately, so presets stay instant.
 */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, TextInput } from '@/components/ui/Field';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ReceiptLink } from './ReceiptControls';
import type { CompanyExpense, WithEmployee } from '@/types/db';

const CATEGORIES = ['Travel','Food','Local Conveyance','Parts/Components','Accommodation','Other'];

export function ExpenseReportsPage() {
  const now = new Date();
  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState('');
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(isoDate(rangeDates(DEFAULT_RANGE, now)![0]));
  const [to, setTo] = useState(isoDate(rangeDates(DEFAULT_RANGE, now)![1]));
  const [moreOpen, setMoreOpen] = useState(false);
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);

  // Shown on the collapsed button so a hidden filter is never forgotten.
  const activeExtra = [category, clientId, status].filter(Boolean).length;

  /** Choosing a preset fills From/To from the same function the default uses. */
  function applyRange(key: RangeKey) {
    setRange(key);
    const span = rangeDates(key, new Date());
    if (!span) return;            // 'custom' keeps whatever dates are showing
    setFrom(isoDate(span[0]));
    setTo(isoDate(span[1]));
  }

  /** Clear every filter back to the screen's default view. */
  function resetFilters() {
    setEmployeeId('');
    setCategory('');
    setClientId('');
    setStatus('');
    applyRange(DEFAULT_RANGE);
    setMoreOpen(false);
  }

  const refs = useQuery(async () => {
    const [emps, clients] = await Promise.all([employeesApi.listActive(), clientApi.list()]);
    return { emps, clients };
  }, []);

  // Unfiltered by design — it reports every claim's settlement state, so it is
  // fetched once rather than on every filter change.
  const settle = useQuery(() => reimbursementApi.claimStatus(), []);

  /*
   * Filters apply as they are chosen. There is deliberately no Apply step: the
   * query was previously keyed on a counter, so the controls and the table could
   * disagree — someone changing Employee without pressing Apply read one
   * person's figures as another's. Only the custom date inputs are debounced,
   * since those are typed; every other control is a single discrete choice.
   */
  const debFrom = useDebounced(from, 300);
  const debTo = useDebounced(to, 300);
  const qFrom = range === 'custom' ? debFrom : from;
  const qTo = range === 'custom' ? debTo : to;

  const q = useQuery(() => expenseApi.listAll({
    employeeId: employeeId || undefined,
    category: category || undefined,
    clientId: clientId || undefined,
    status: (status || undefined) as CompanyExpense['status'] | undefined,
    from: qFrom || undefined,
    to: qTo || undefined,
  }), [employeeId, category, clientId, status, qFrom, qTo]);

  const rows = q.data ?? [];

  /**
   * Is this an approved claim the company has not settled — by reimbursement
   * or against an advance? The money has been spent but nothing has been
   * done about it, which is what the highlight is for.
   */
  const settleByExpense = new Map(
    (settle.data ?? []).map((c) => [c.expense_id, c]));
  const isUnsettled = (r: CompanyExpense) =>
    settleByExpense.get(r.id)?.is_reimbursable === true;

  // Owed within the filtered set, so it matches the rows on screen.
  const unsettledRows = rows.filter(isUnsettled);
  const awaitingCount = unsettledRows.length;
  const awaitingOwed = unsettledRows.reduce(
    (t, r) => t + Number(settleByExpense.get(r.id)?.outstanding_amount ?? 0), 0);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const approvedTotal = rows.filter((r) => r.status === 'approved')
    .reduce((s, r) => s + Number(r.amount), 0);

  const byCategory = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'approved') continue;
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + Number(r.amount));
  }

  const columns: Column<WithEmployee<CompanyExpense>>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.expense_date),
      // ISO date, so it sorts chronologically rather than alphabetically.
      sortValue: (r) => r.expense_date },
    { key: 'emp', header: 'Employee',
      cell: (r) => `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim() || '—',
      // Employee code, so the order matches every other screen.
      sortValue: (r) => r.employees?.employee_code },
    { key: 'cat', header: 'Category', cell: (r) => r.category,
      sortValue: (r) => r.category },
    { key: 'settle', header: 'Type',
      cell: (r) => {
        const st = settleByExpense.get(r.id);
        if (!st || r.status !== 'approved') {
          return <span className="muted">—</span>;
        }
        if (st.reimbursement_status === 'accounted_against_advance') {
          return <Badge tone="neutral-alt">Paid from advance</Badge>;
        }
        if (st.reimbursement_status === 'reimbursed') {
          return <Badge tone="success">Settled</Badge>;
        }
        if (st.reimbursement_status === 'partially_reimbursed') {
          return <Badge tone="warn">Partially settled</Badge>;
        }
        return <Badge tone="warn">Approved · not settled</Badge>;
      },
      sortValue: (r) => settleByExpense.get(r.id)?.reimbursement_status },
    { key: 'amt', header: 'Amount', align: 'right', cell: (r) => formatCurrency(r.amount),
      sortValue: (r) => Number(r.amount) },
    { key: 'bill', header: 'Bill no.', cell: (r) => r.bill_number || '—' },
    { key: 'desc', header: 'Description',
      cell: (r) => {
        const st = settleByExpense.get(r.id);
        const outstanding = Number(st?.outstanding_amount ?? 0);
        return (
          <>
            {r.description || '—'}
            {isUnsettled(r) && (
              <span className="meta">
                {st?.reimbursement_status === 'partially_reimbursed'
                  ? `${formatCurrency(outstanding)} still to be settled`
                  : 'Not yet settled or accounted'}
              </span>
            )}
          </>
        );
      } },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status },
    { key: 'acct', header: 'Accounted', align: 'right',
      cell: (r) => r.accounted_advance_id ? formatCurrency(r.accounted_amount ?? 0) : '—',
      // Unaccounted claims sort last, which is usually what you want to find.
      sortValue: (r) => r.accounted_advance_id ? Number(r.accounted_amount ?? 0) : null },
    { key: 'receipt', header: 'Receipt', align: 'right',
      cell: (r) => <ReceiptLink path={r.receipt_url} /> },
  ];

  return (
    <>
      <PageHeader title="Expense reports" subtitle="Filter and review company expenses" />

      <Card>
        {/* Date and employee lead, since those are the filters actually used.
            The rest sit behind "More filters" so the report starts near the
            top of the page. Toggled by click, not hover. */}
        <div className="filter-row">
          <Select label="Range" value={range}
            onChange={(e) => applyRange(e.target.value as RangeKey)}>
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </Select>
          {/* On a preset the dates are shown as text, not inputs: two pickers
              are the bulk of this row's weight and are rarely touched, but the
              period being reported must still be stated — reading money figures
              without knowing the period is the same trap as a stale table.
              Choosing Custom reveals the inputs, pre-filled with the preset's
              dates so a range can be nudged rather than retyped. They cannot
              then contradict the dropdown, because they only exist in Custom. */}
          {range === 'custom' ? (
            <>
              <TextInput label="From date" type="date" value={from}
                onChange={(e) => setFrom(e.target.value)} />
              <TextInput label="To date" type="date" value={to}
                onChange={(e) => setTo(e.target.value)} />
            </>
          ) : (
            <div className="field">
              <span className="field-label">Showing</span>
              <p className="range-label">
                {formatDate(from)} – {formatDate(to)}
              </p>
            </div>
          )}
          <Select label="Employee" value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All employees</option>
            {(refs.data?.emps ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
              </option>
            ))}
          </Select>
          <div className="field">
            <span className="field-label">&nbsp;</span>
            <Button size="sm" variant="secondary"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}>
              <FilterIcon /> More filters
              {activeExtra > 0 && (
                <span className="filter-count">{activeExtra}</span>
              )}
            </Button>
          </div>
        </div>

        {moreOpen && (
          <div className="filter-row" style={{ marginTop: 12 }}>
            <Select label="Category" value={category}
              onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select label="Client" value={clientId}
              onChange={(e) => setClientId(e.target.value)}>
              <option value="">All clients</option>
              {(refs.data?.clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Select label="Status" value={status}
              onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </div>
        )}

        {/* Reset only: filters apply as they are chosen, so there is nothing to
            confirm. Kept on its own row so it reads as applying to everything
            above rather than sitting inside the filter grid. */}
        <div className="filter-actions">
          <Button size="sm" variant="ghost" onClick={resetFilters}>Reset</Button>
        </div>
      </Card>

      {q.loading ? <Spinner label="Loading expenses…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : (
          <>
            <div className="stat-grid">
              {/* These three money figures NEST, they do not sum: awaiting is
                  a subset of approved, which is a subset of claimed. The hints
                  say so, because four tiles in a row otherwise read as parts of
                  a whole and invite adding them up. */}
              <StatCard label="Claims" value={rows.length} />
              <StatCard label="Total claimed amount" value={formatCurrency(total)}
                hint="All statuses" />
              <StatCard label="Total approved amount"
                value={formatCurrency(approvedTotal)} tone="good"
                hint="Included in claimed" />
              <StatCard label="Awaiting settlement"
                value={formatCurrency(awaitingOwed)}
                tone={awaitingOwed > 0 ? 'pending' : 'default'}
                hint={awaitingCount === 0
                  ? 'Nothing outstanding'
                  : `${awaitingCount} claim${awaitingCount === 1 ? '' : 's'}, `
                    + 'included in approved'} />
            </div>

            {/*
              * Where to go next, sitting directly under the figure it refers
              * to. Both routes are tabs of Advance Ledger, so this is one
              * destination with two doors rather than two screens.
              *
              * "Settled" deliberately, not "pending": these claims are
              * APPROVED, and the table below uses Pending for claims still
              * awaiting a decision.
              */}
            {awaitingOwed > 0 && (
              <p className="settle-prompt">
                <strong>
                  {awaitingCount} claim{awaitingCount === 1 ? '' : 's'},
                  {' '}{formatCurrency(awaitingOwed)}, approved but not settled.
                </strong>
                {/* The Account button lives on one employee's ledger, so the
                    filtered employee is carried over when there is one. */}
                <Link to={`/admin/company-advance${employeeId ? `?employee=${employeeId}` : ''}`}>
                  Account against an advance →
                </Link>
                <Link to="/admin/company-advance?tab=reimbursements">
                  Record a reimbursement →
                </Link>
              </p>
            )}

            {byCategory.size > 0 && (
              <Card title="Approved by category">
                {/*
                  * Each chip filters the table to its category — the obvious
                  * next step after reading the breakdown. Clicking the active
                  * one clears it, so a chip is never a one-way door, and the
                  * Category select stays in step because both write the same
                  * piece of state.
                  */}
                <div className="chip-row">
                  {[...byCategory.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat, amt]) => (
                      <button key={cat} type="button"
                        className={`filter-chip ${category === cat ? 'is-active' : ''}`}
                        aria-pressed={category === cat}
                        title={category === cat
                          ? `Showing ${cat} only — click to clear`
                          : `Show only ${cat}`}
                        onClick={() => setCategory(category === cat ? '' : cat)}>
                        {cat}: {formatCurrency(amt)}
                      </button>
                    ))}
                </div>
              </Card>
            )}

            <Card>
              <DataTable
                columns={columns} rows={rows} rowKey={(r) => r.id}
                rowClassName={(r) => isUnsettled(r) ? 'row-unsettled' : ''}
                empty="No expenses match these filters."
                footer={
                  <tr>
                    <td colSpan={3} className="fw-bold">Total</td>
                    <td className="fw-bold" style={{ textAlign: 'right' }}>{formatCurrency(total)}</td>
                    <td colSpan={5} />
                  </tr>
                }
              />
            </Card>
          </>
        )}
    </>
  );
}
