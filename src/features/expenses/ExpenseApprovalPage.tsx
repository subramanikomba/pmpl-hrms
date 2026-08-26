import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { advanceApi, expenseApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { round2 } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput } from '@/components/ui/Field';
import { ReceiptLink } from './ReceiptControls';
import type { ApprovalStatus, CompanyExpense, WithEmployee } from '@/types/db';

export function ExpenseApprovalPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<ApprovalStatus | 'all'>('pending');
  const [approving, setApproving] = useState<WithEmployee<CompanyExpense> | null>(null);

  const q = useQuery(
    () => expenseApi.listAll(filter === 'all' ? {} : { status: filter }),
    [filter],
  );

  async function reject(e: WithEmployee<CompanyExpense>) {
    if (!employee) return;
    try {
      await expenseApi.reject(e.id, employee.id);
      toast.info('Expense rejected.');
      q.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject expense');
    }
  }

  return (
    <>
      <PageHeader
        title="Expense approvals"
        subtitle="Approve claims, optionally accounting them against a company advance"
      />

      <Card>
        <Select label="Filter by status" value={filter}
          onChange={(e) => setFilter(e.target.value as ApprovalStatus | 'all')}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </Select>
      </Card>

      {q.loading ? <Spinner label="Loading expense claims…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : (q.data ?? []).length === 0
          ? <Card><p className="muted">No expense claims match this filter.</p></Card>
          : (q.data ?? []).map((e) => (
            <Card key={e.id}>
              <div className="approval-head">
                <div>
                  <strong>{e.employees?.first_name} {e.employees?.last_name}</strong>{' '}
                  <span className="muted">{e.employees?.employee_code}</span>
                </div>
                <StatusBadge status={e.status} />
              </div>
              <p className="expense-line">
                <span className="chip">{e.category}</span>
                <strong className="amount">{formatCurrency(e.amount)}</strong>
                <span className="muted">{formatDate(e.expense_date)}</span>
              </p>
              {e.paid_from_advance && (
                <p className="advance-flag">
                  Employee indicated this was paid from a company advance
                </p>
              )}
              {e.bill_number && <p className="muted">Bill: {e.bill_number}</p>}
              {e.description && <p>{e.description}</p>}
              <p className="receipt-row"><ReceiptLink path={e.receipt_url} /></p>

              {e.status === 'pending' ? (
                <div className="row-end gap">
                  <Button variant="ghost" onClick={() => void reject(e)}>Reject</Button>
                  <Button variant="success" onClick={() => setApproving(e)}>Approve…</Button>
                </div>
              ) : (
                <p className="decision-note">
                  {e.status === 'approved' ? 'Approved' : 'Rejected'} on {formatDate(e.reviewed_at)}
                  {e.accounted_advance_id
                    ? ` — ${formatCurrency(e.accounted_amount ?? 0)} accounted against an advance`
                    : ''}
                </p>
              )}
            </Card>
          ))}

      {approving && (
        <ApproveExpenseModal
          expense={approving}
          onClose={() => setApproving(null)}
          onDone={() => { setApproving(null); q.reload(); }}
        />
      )}
    </>
  );
}

/**
 * Spec: an expense may stand alone, or Admin may account it against an
 * outstanding company advance. Only advances with a remaining balance are
 * offered, and the accounted amount is capped by both the expense amount
 * and that remaining balance.
 */
function ApproveExpenseModal(
  { expense, onClose, onDone }:
  { expense: WithEmployee<CompanyExpense>; onClose: () => void; onDone: () => void },
) {
  const { employee } = useAuth();
  const toast = useToast();
  const [advanceId, setAdvanceId] = useState('');
  const [seeded, setSeeded] = useState(false);
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
      used.set(
        e.accounted_advance_id,
        (used.get(e.accounted_advance_id) ?? 0) + Number(e.accounted_amount ?? 0),
      );
    }
    return advances
      .map((a) => ({ ...a, remaining: round2(Number(a.amount) - (used.get(a.id) ?? 0)) }))
      .filter((a) => a.remaining > 0);
  }, [expense.employee_id]);

  const options = q.data ?? [];

  // The employee indicated they paid from the advance: pre-select it so the
  // admin usually just confirms. Still fully overridable — a hint, not a rule.
  if (!seeded && expense.paid_from_advance && options.length > 0) {
    const first = options[0];
    if (first) {
      setAdvanceId(first.id);
      setAmount(String(Math.min(Number(expense.amount), first.remaining)));
      setSeeded(true);
    }
  }
  const selected = options.find((a) => a.id === advanceId);
  const maxAmount = selected
    ? Math.min(Number(expense.amount), selected.remaining)
    : Number(expense.amount);

  async function confirm() {
    if (!employee) return;
    setSaving(true);
    try {
      if (advanceId) {
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt <= 0 || amt > maxAmount) {
          toast.error(`Enter an amount between 0 and ${formatCurrency(maxAmount)}.`);
          setSaving(false);
          return;
        }
        await expenseApi.approve(expense.id, employee.id, { advanceId, amount: amt });
        toast.success('Expense approved and accounted against the advance.');
      } else {
        await expenseApi.approve(expense.id, employee.id);
        toast.success('Expense approved.');
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve expense');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Approve expense" onClose={onClose}>
      <p>Expense amount: <strong>{formatCurrency(expense.amount)}</strong></p>

      {q.loading ? <Spinner /> : options.length === 0 ? (
        <p className="muted">
          This employee has no outstanding company advance. The expense will be
          approved on its own.
        </p>
      ) : (
        <>
          <Select
            label="Account against a company advance (optional)"
            value={advanceId}
            onChange={(e) => {
              setAdvanceId(e.target.value);
              const a = options.find((x) => x.id === e.target.value);
              setAmount(String(a ? Math.min(Number(expense.amount), a.remaining) : expense.amount));
            }}
          >
            <option value="">— Do not account against an advance —</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {formatDate(a.advance_date)} · {formatCurrency(a.amount)}
                {' '}(available {formatCurrency(a.remaining)})
              </option>
            ))}
          </Select>

          {advanceId && (
            <TextInput
              label="Amount to account (₹)" type="number" min="0.01" step="0.01"
              max={maxAmount} value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={`Cannot exceed ${formatCurrency(maxAmount)}`}
            />
          )}
        </>
      )}

      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="success" disabled={saving} onClick={() => void confirm()}>
          {saving ? 'Approving…' : 'Confirm approval'}
        </Button>
      </div>
    </Modal>
  );
}
