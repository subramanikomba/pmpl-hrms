import { useMemo, useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import {
  employeesApi, reimbursementApi, settingsApi,
} from '@/lib/api';
import { round2 } from '@/lib/payroll';
import { formatCurrency, formatDate } from '@/lib/format';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Select } from '@/components/ui/Field';
import { RecordReimbursementModal } from './RecordReimbursementModal';
import { generateVoucherPdf } from './voucherDocument';
import type { Employee, ExpenseReimbursementStatus } from '@/types/db';

/**
 * Employee expense reimbursement.
 *
 * Deliberately separate from the Company Advance ledger, even though both
 * live under Expense Ledger: a reimbursement pays an employee back for money
 * they already spent, so it never touches the advance running balance.
 *
 * Claims already accounted against a company advance are shown but are not
 * payable — the company has funded those once already.
 */
export function ReimbursementsTab() {
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [paying, setPaying] = useState<Employee | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery(async () => {
    const [employees, claims, payments] = await Promise.all([
      employeesApi.list(),
      reimbursementApi.claimStatus(),
      reimbursementApi.listAll(),
    ]);
    return { employees, claims, payments };
  }, []);

  const employees = q.data?.employees ?? [];
  const allClaims = q.data?.claims ?? [];
  const payments = q.data?.payments ?? [];

  const claims = useMemo(
    () => (employeeId
      ? allClaims.filter((c) => c.employee_id === employeeId)
      : allClaims),
    [allClaims, employeeId],
  );

  /** Employees with something still owed, and how much. */
  const pendingByEmployee = useMemo(() => {
    const map = new Map<string, { employee: Employee; claims: ExpenseReimbursementStatus[]; total: number }>();
    for (const c of claims) {
      if (!c.is_reimbursable) continue;
      const employee = employees.find((e) => e.id === c.employee_id);
      if (!employee) continue;
      const row = map.get(c.employee_id)
        ?? { employee, claims: [], total: 0 };
      row.claims.push(c);
      row.total = round2(row.total + Number(c.outstanding_amount));
      map.set(c.employee_id, row);
    }
    return [...map.values()]
      .sort((a, b) => a.employee.employee_code.localeCompare(b.employee.employee_code));
  }, [claims, employees]);

  const pendingTotal = round2(
    pendingByEmployee.reduce((t, r) => t + r.total, 0));
  const excluded = claims.filter(
    (c) => c.reimbursement_status === 'accounted_against_advance');

  async function downloadVoucher(paymentId: string) {
    setBusy(paymentId);
    try {
      const payment = payments.find((p) => p.id === paymentId);
      if (!payment) return;
      const employee = employees.find((e) => e.id === payment.employee_id);
      if (!employee) throw new Error('Employee not found.');

      const [settings, items] = await Promise.all([
        settingsApi.get(),
        reimbursementApi.itemsFor(payment.id),
      ]);

      // Rebuild the claim lines as they stood for THIS payment: everything
      // paid against the claim before it counts as previously paid.
      const lines = items.map((it) => {
        const claim = allClaims.find((c) => c.expense_id === it.expense_id);
        const approved = Number(claim?.approved_amount ?? it.amount);
        const paidTotal = Number(claim?.reimbursed_amount ?? it.amount);
        return {
          date: claim?.expense_date ?? payment.payment_date,
          category: claim?.category ?? 'Expense',
          description: claim?.description ?? null,
          approved,
          previouslyPaid: round2(paidTotal - Number(it.amount)),
          paidNow: Number(it.amount),
          outstanding: round2(approved - paidTotal),
        };
      });

      await generateVoucherPdf({
        kind: 'reimbursement',
        voucherNo: payment.voucher_no,
        paymentDate: payment.payment_date,
        amount: Number(payment.amount),
        paymentMode: payment.payment_mode,
        reference: payment.reference,
        notes: payment.notes,
        employee,
        settings,
        claims: lines,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the voucher');
    } finally { setBusy(null); }
  }

  if (q.loading) return <Spinner label="Loading reimbursements…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;

  return (
    <>
      <Card>
        <Select label="Employee" value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.employee_code} — {e.first_name} {e.last_name}
            </option>
          ))}
        </Select>
      </Card>

      <div className="stat-grid">
        <StatCard label="Pending reimbursement"
          value={formatCurrency(pendingTotal)}
          tone={pendingTotal > 0 ? 'warn' : 'default'} />
        <StatCard label="Employees awaiting payment"
          value={pendingByEmployee.length} />
        <StatCard label="Payments recorded" value={payments.length} />
      </div>

      <Card title="Pending reimbursement">
        <p className="muted small">
          Approved claims the employee paid for themselves and has not yet been
          reimbursed for. Reimbursement does not affect salary, payroll or the
          company advance balance.
        </p>
        {pendingByEmployee.length === 0 ? (
          <p className="muted">Nothing is awaiting reimbursement.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Claims</th>
                  <th className="num">Pending amount</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingByEmployee.map((r) => (
                  <tr key={r.employee.id}>
                    <td>
                      <strong>{r.employee.employee_code}</strong>
                      <div className="emp-name">
                        {r.employee.first_name} {r.employee.last_name}
                      </div>
                    </td>
                    <td className="num">{r.claims.length}</td>
                    <td className="num"><strong>{formatCurrency(r.total)}</strong></td>
                    <td style={{ textAlign: 'right' }}>
                      <Button size="sm" variant="primary"
                        onClick={() => setPaying(r.employee)}>
                        Record reimbursement
                      </Button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="num">
                    <strong>
                      {pendingByEmployee.reduce((t, r) => t + r.claims.length, 0)}
                    </strong>
                  </td>
                  <td className="num"><strong>{formatCurrency(pendingTotal)}</strong></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {excluded.length > 0 && (
        <Card title="Not reimbursable">
          <p className="muted small">
            These approved claims were accounted against a company advance the
            employee was holding, so the company has already funded them. They
            cannot be reimbursed again.
          </p>
          <ul className="plain-list">
            {excluded.map((c) => {
              const e = employees.find((x) => x.id === c.employee_id);
              return (
                <li key={c.expense_id}>
                  <span>
                    {e ? `${e.employee_code} ${e.first_name}` : '—'}
                    {' · '}{formatDate(c.expense_date)} · {c.category}
                  </span>
                  <strong>{formatCurrency(c.approved_amount)}</strong>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Reimbursement payments">
        {payments.length === 0 ? (
          <p className="muted">No reimbursement payments recorded yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Voucher</th>
                  <th>Employee</th>
                  <th>Paid on</th>
                  <th>Mode / reference</th>
                  <th className="num">Amount</th>
                  <th style={{ textAlign: 'right' }}>Voucher</th>
                </tr>
              </thead>
              <tbody>
                {payments
                  .filter((p) => !employeeId || p.employee_id === employeeId)
                  .map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.voucher_no}</strong></td>
                      <td>
                        {p.employees?.employee_code}
                        <div className="emp-name">
                          {p.employees?.first_name} {p.employees?.last_name}
                        </div>
                      </td>
                      <td>{formatDate(p.payment_date)}</td>
                      <td>
                        {p.payment_mode}
                        {p.reference && (
                          <div className="muted small">{p.reference}</div>
                        )}
                      </td>
                      <td className="num">
                        <strong>{formatCurrency(p.amount)}</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {p.attachment_url && (
                          <Badge tone={p.attachment_shared ? 'info' : 'neutral-alt'}>
                            {p.attachment_shared ? 'Proof shared' : 'Proof: admin only'}
                          </Badge>
                        )}{' '}
                        <Button size="sm" variant="secondary"
                          disabled={busy === p.id}
                          onClick={() => void downloadVoucher(p.id)}>
                          Download
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {paying && (
        <RecordReimbursementModal
          employee={paying}
          claims={allClaims.filter(
            (c) => c.employee_id === paying.id && c.is_reimbursable)}
          onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); q.reload(); }}
        />
      )}
    </>
  );
}
