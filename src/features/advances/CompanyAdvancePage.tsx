import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { advanceApi, employeesApi, expenseApi } from '@/lib/api';
import { round2 } from '@/lib/payroll';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, TextInput } from '@/components/ui/Field';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { CompanyExpense, Employee, LedgerRow } from '@/types/db';

type Tab = 'ledger' | 'summary';

export function CompanyAdvancePage() {
  const { employee } = useAuth();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [accounting, setAccounting] = useState<CompanyExpense | null>(null);
  const [tab, setTab] = useState<Tab>('ledger');

  const emps = useQuery(() => employeesApi.listActive(), []);
  const ledger = useQuery(
    () => employeeId ? advanceApi.ledgerFor(employeeId) : Promise.resolve([]),
    [employeeId],
  );

  // Approved claims the admin has NOT accounted against an advance. These are
  // deliberately kept out of the balance so company advances and expense
  // claims never blur together.
  const unreconciled = useQuery(
    () => employeeId
      ? expenseApi.listAll({ employeeId, status: 'approved' })
          .then((rows) => rows.filter((r) => !r.accounted_advance_id))
      : Promise.resolve([]),
    [employeeId],
  );

  const rows = ledger.data ?? [];
  const closing = rows.length > 0 ? (rows[rows.length - 1]?.running_balance ?? 0) : 0;
  const totalGiven = rows.reduce((sum, r) => sum + Number(r.debit ?? 0), 0);
  const totalAccounted = rows.reduce((sum, r) => sum + Number(r.credit ?? 0), 0);

  /** Reverse an accounting entry. Confirmed because it moves the balance. */
  async function unaccount(row: LedgerRow) {
    const ok = window.confirm(
      `Remove ${formatCurrency(row.credit)} from this advance?\n\n`
      + 'The claim stays approved, but it will no longer settle the advance '
      + 'and the outstanding balance will increase by this amount.',
    );
    if (!ok) return;
    try {
      await expenseApi.unaccount(row.txn_id);
      toast.success('Removed from the advance. Balance updated.');
      ledger.reload(); unreconciled.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not un-account the claim');
    }
  }

  async function give() {
    if (!employee || !employeeId) { toast.error('Select an employee first.'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      await advanceApi.give({
        employee_id: employeeId, advance_date: date, amount: amt,
        reference, note, given_by: employee.id,
      });
      toast.success('Company advance recorded.');
      setAmount(''); setReference(''); setNote('');
      ledger.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record advance');
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<LedgerRow>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.txn_date) },
    { key: 'type', header: 'Type',
      cell: (r) => <Badge tone={r.txn_type === 'advance' ? 'info' : 'neutral-alt'}>
        {r.txn_type === 'advance' ? 'Advance given' : 'Expense accounted'}
      </Badge> },
    { key: 'debit', header: 'Advance', align: 'right',
      cell: (r) => r.debit > 0 ? formatCurrency(r.debit) : '—' },
    { key: 'credit', header: 'Accounted', align: 'right',
      cell: (r) => r.credit > 0 ? formatCurrency(r.credit) : '—' },
    { key: 'ref', header: 'Reference', cell: (r) => r.reference || '—' },
    { key: 'desc', header: 'Description', cell: (r) => r.description || '—' },
    { key: 'bal', header: 'Balance', align: 'right',
      cell: (r) => <strong>{formatCurrency(r.running_balance)}</strong> },
    { key: 'act', header: '', align: 'right',
      cell: (r) => r.txn_type === 'expense'
        ? (
          <Button size="sm" variant="ghost"
            onClick={() => void unaccount(r)}>Un-account</Button>
        )
        : null },
  ];

  return (
    <>
      <PageHeader
        title="Company advance & expense ledger"
        subtitle="Company money given to employees, and expenses accounted against it"
      />

      <div className="tabbar" role="tablist" aria-label="Advance and expense views">
        <button
          role="tab" aria-selected={tab === 'ledger'}
          className={`tab ${tab === 'ledger' ? 'is-active' : ''}`}
          onClick={() => setTab('ledger')}
        >
          Employee ledger
        </button>
        <button
          role="tab" aria-selected={tab === 'summary'}
          className={`tab ${tab === 'summary' ? 'is-active' : ''}`}
          onClick={() => setTab('summary')}
        >
          Advance &amp; expense summary
        </button>
      </div>

      {tab === 'summary' ? <AdvanceExpenseSummary /> : (
      <>
      <Card title="Give a company advance">
        <div className="form-grid-2">
          <Select label="Employee" value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select an employee…</option>
            {(emps.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
              </option>
            ))}
          </Select>
          <TextInput label="Date" type="date" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-grid-2">
          <TextInput label="Amount (₹)" type="number" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
          <TextInput label="Reference" value={reference}
            onChange={(e) => setReference(e.target.value)} placeholder="Cheque / UTR / Cash" />
        </div>
        <TextInput label="Note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Purpose of the advance" />
        <Button variant="primary" disabled={saving || !employeeId}
          onClick={() => void give()}>Record advance</Button>
      </Card>

      {employeeId && (
        <>
          <div className="stat-grid">
            <StatCard label="Advance given" value={formatCurrency(totalGiven)} />
            <StatCard label="Expenses accounted" value={formatCurrency(totalAccounted)} />
            <StatCard
              label="Balance outstanding"
              value={formatCurrency(closing)}
              tone={closing > 0 ? 'warn' : 'good'}
            />
          </div>

          {(unreconciled.data ?? []).length > 0 && (
            <Card title="Approved, not yet accounted" className="mid">
              <p className="muted small">
                These approved claims do not affect the advance balance yet.
                Use <strong>Account</strong> to settle one against an advance.
              </p>
              <DataTable
                columns={[
                  { key: 'date', header: 'Date', cell: (r) => formatDate(r.expense_date) },
                  { key: 'cat', header: 'Category', cell: (r) => r.category },
                  { key: 'amt', header: 'Amount', align: 'right',
                    cell: (r) => formatCurrency(r.amount) },
                  { key: 'hint', header: '', cell: (r) => r.paid_from_advance
                      ? <span className="advance-flag-chip">from advance</span> : null },
                  { key: 'act', header: '', align: 'right',
                    cell: (r) => (
                      <Button size="sm" variant="primary"
                        onClick={() => setAccounting(r)}>Account</Button>
                    ) },
                ]}
                rows={unreconciled.data ?? []}
                rowKey={(r) => r.id}
              />
            </Card>
          )}
        </>
      )}

      {accounting && (
        <AccountClaimModal
          expense={accounting}
          onClose={() => setAccounting(null)}
          onDone={() => { setAccounting(null); ledger.reload(); unreconciled.reload(); }}
        />
      )}

      {employeeId && (
        <Card title="Ledger" actions={
          <span className="ledger-balance">
            Closing balance: <strong>{formatCurrency(closing)}</strong>
          </span>
        }>
          {ledger.loading ? <Spinner />
            : <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.txn_type}-${r.txn_id}`}
                empty="No advances or accounted expenses for this employee yet." />}
        </Card>
      )}
      </>
      )}
    </>
  );
}

/* ── Company-wide advance & expense summary ────────────────────
 * A roll-up of the SAME company_advance_ledger view the employee ledger
 * uses, so both screens can never disagree. Pending claims are counted
 * separately: they are not approved, so they do not touch the balance.
 */
interface SummaryRow {
  employee: Employee;
  given: number;
  accounted: number;
  outstanding: number;
  pending: number;
}

function AdvanceExpenseSummary() {
  const q = useQuery(async () => {
    const [employees, ledger, pending] = await Promise.all([
      employeesApi.listActive(),
      advanceApi.ledgerAll(),
      expenseApi.listAll({ status: 'pending' }),
    ]);

    const pendingCount = new Map<string, number>();
    for (const e of pending) {
      pendingCount.set(e.employee_id, (pendingCount.get(e.employee_id) ?? 0) + 1);
    }

    const rows: SummaryRow[] = employees.map((employee) => {
      const mine = ledger.filter((l) => l.employee_id === employee.id);
      const given = round2(mine.reduce((t, l) => t + Number(l.debit ?? 0), 0));
      const accounted = round2(mine.reduce((t, l) => t + Number(l.credit ?? 0), 0));
      return {
        employee, given, accounted,
        outstanding: round2(given - accounted),
        pending: pendingCount.get(employee.id) ?? 0,
      };
    });
    // Employees with nothing to report would only pad the table.
    return rows.filter((r) => r.given > 0 || r.accounted > 0 || r.pending > 0);
  }, []);

  if (q.loading) return <Spinner label="Loading summary…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;

  const rows = q.data ?? [];
  const totals = rows.reduce(
    (t, r) => ({
      given: round2(t.given + r.given),
      accounted: round2(t.accounted + r.accounted),
      outstanding: round2(t.outstanding + r.outstanding),
      pending: t.pending + r.pending,
    }),
    { given: 0, accounted: 0, outstanding: 0, pending: 0 },
  );

  const columns: Column<SummaryRow>[] = [
    { key: 'emp', header: 'Employee',
      cell: (r) => (
        <>
          <strong>{r.employee.employee_code}</strong>
          <div className="emp-name">
            {r.employee.first_name} {r.employee.last_name}
          </div>
        </>
      ) },
    { key: 'given', header: 'Advances given', align: 'right',
      cell: (r) => formatCurrency(r.given) },
    { key: 'acc', header: 'Expenses accounted', align: 'right',
      cell: (r) => formatCurrency(r.accounted) },
    { key: 'out', header: 'Outstanding', align: 'right',
      cell: (r) => <strong>{formatCurrency(r.outstanding)}</strong> },
    { key: 'pend', header: 'Pending claims', align: 'right',
      cell: (r) => r.pending > 0
        ? <Badge tone="warn">{r.pending}</Badge>
        : <span className="muted">—</span> },
  ];

  return (
    <Card title="Advance & expense summary — all employees">
      <p className="muted small">
        Balances come from the same ledger as the employee view. Pending claims
        are awaiting approval and do not affect the outstanding balance.
      </p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.employee.id}
        empty="No company advances or accounted expenses recorded yet."
        footer={rows.length > 0 ? (
          <tr>
            <td><strong>Total</strong></td>
            <td style={{ textAlign: 'right' }}>
              <strong>{formatCurrency(totals.given)}</strong>
            </td>
            <td style={{ textAlign: 'right' }}>
              <strong>{formatCurrency(totals.accounted)}</strong>
            </td>
            <td style={{ textAlign: 'right' }}>
              <strong>{formatCurrency(totals.outstanding)}</strong>
            </td>
            <td style={{ textAlign: 'right' }}>
              <strong>{totals.pending || '—'}</strong>
            </td>
          </tr>
        ) : undefined}
      />
    </Card>
  );
}

/* ── Account an already-approved claim against an advance ──────
 * Corrects the case where a claim was approved without selecting an
 * advance. Uses the same rules as approval: only advances with a
 * remaining balance, capped by both the claim amount and that balance.
 */
function AccountClaimModal(
  { expense, onClose, onDone }:
  { expense: CompanyExpense; onClose: () => void; onDone: () => void },
) {
  const toast = useToast();
  const [advanceId, setAdvanceId] = useState('');
  const [amount, setAmount] = useState(String(expense.amount));
  const [saving, setSaving] = useState(false);

  const q = useQuery(async () => {
    const [advances, approved] = await Promise.all([
      advanceApi.listFor(expense.employee_id),
      expenseApi.listAll({ employeeId: expense.employee_id, status: 'approved' }),
    ]);
    const used = new Map<string, number>();
    for (const e of approved) {
      if (!e.accounted_advance_id) continue;
      used.set(e.accounted_advance_id,
        (used.get(e.accounted_advance_id) ?? 0) + Number(e.accounted_amount ?? 0));
    }
    return advances
      .map((a) => ({ ...a, remaining: round2(Number(a.amount) - (used.get(a.id) ?? 0)) }))
      .filter((a) => a.remaining > 0);
  }, [expense.employee_id]);

  const options = q.data ?? [];
  const selected = options.find((a) => a.id === advanceId);
  const maxAmount = selected
    ? Math.min(Number(expense.amount), selected.remaining)
    : Number(expense.amount);

  async function confirm() {
    const amt = Number(amount);
    if (!advanceId) { toast.error('Select an advance to account against.'); return; }
    if (!Number.isFinite(amt) || amt <= 0 || amt > maxAmount) {
      toast.error(`Enter an amount between 0 and ${formatCurrency(maxAmount)}.`);
      return;
    }
    setSaving(true);
    try {
      await expenseApi.accountAgainstAdvance(expense.id, advanceId, amt);
      toast.success('Claim accounted against the advance.');
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not account the claim');
    } finally { setSaving(false); }
  }

  return (
    <Modal open title="Account claim against an advance" onClose={onClose}
      dismissOnBackdrop={false}>
      <p>
        {expense.category} — <strong>{formatCurrency(expense.amount)}</strong>
        {' '}on {formatDate(expense.expense_date)}
      </p>
      {expense.paid_from_advance && (
        <p className="advance-flag">
          The employee indicated this was paid from a company advance.
        </p>
      )}

      {q.loading ? <Spinner /> : options.length === 0 ? (
        <p className="callout-warn">
          This employee has no advance with a remaining balance, so there is
          nothing to account this claim against.
        </p>
      ) : (
        <>
          <Select label="Advance" value={advanceId}
            onChange={(e) => {
              setAdvanceId(e.target.value);
              const a = options.find((x) => x.id === e.target.value);
              setAmount(String(a ? Math.min(Number(expense.amount), a.remaining)
                                 : expense.amount));
            }}>
            <option value="">Select an advance…</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {formatDate(a.advance_date)} · {formatCurrency(a.amount)}
                {' '}(available {formatCurrency(a.remaining)})
              </option>
            ))}
          </Select>
          {advanceId && (
            <TextInput label="Amount to account (₹)" type="number"
              min="0.01" step="0.01" max={maxAmount} value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={`Cannot exceed ${formatCurrency(maxAmount)}`} />
          )}
        </>
      )}

      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || !advanceId}
          onClick={() => void confirm()}>
          {saving ? 'Accounting…' : 'Account against advance'}
        </Button>
      </div>
    </Modal>
  );
}
