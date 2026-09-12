import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import {
  advanceApi, clientApi, expenseApi, reimbursementApi, settingsApi,
} from '@/lib/api';
import {
  generateVoucherPdf, generateVoucherPreview, type VoucherData,
} from '@/features/vouchers/voucherDocument';
import { EyeIcon } from '@/components/ui/Icons';
import { PdfViewerModal } from '@/features/payroll/PdfViewerModal';
import { ClientLocationSelect } from '@/components/ui/ClientLocationSelect';
import { formatCurrency, formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Checkbox, Select, TextArea, TextInput } from '@/components/ui/Field';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ReceiptPicker, ReceiptLink } from './ReceiptControls';
import type { CompanyExpense } from '@/types/db';

const CATEGORIES = [
  'Travel', 'Food', 'Local Conveyance', 'Parts/Components',
  'Accommodation', 'Other',
] as const;

export function MyExpensesPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const employeeId = employee?.id ?? '';

  const [date, setDate] = useState(isoDate(new Date()));
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [bill, setBill] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientLocationId, setClientLocationId] = useState('');
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewingVoucher, setViewingVoucher] = useState<VoucherData | null>(null);
  const [paidFromAdvance, setPaidFromAdvance] = useState(false);
  // id of the pending claim being edited; null = creating a new one
  const [editingId, setEditingId] = useState<string | null>(null);

  const q = useQuery(async () => {
    const [expenses, clients, ledger, reimbursements, claimStatus] = await Promise.all([
      expenseApi.listFor(employeeId),
      clientApi.list(true),
      advanceApi.ledgerFor(employeeId),
      reimbursementApi.listFor(employeeId),
      reimbursementApi.claimStatus({ employeeId }),
    ]);
    const outstanding = ledger.length > 0
      ? Number(ledger[ledger.length - 1]?.running_balance ?? 0) : 0;
    return { expenses, clients, outstanding, reimbursements, claimStatus };
  }, [employeeId]);

  if (q.loading) return <Spinner label="Loading expenses…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  const {
    expenses = [], clients = [], outstanding = 0, reimbursements = [],
    claimStatus = [],
  } = q.data ?? {};

  /**
   * What the employee is still owed across all their approved claims, from
   * the same derived view the Admin screen uses. Never stored, so it cannot
   * disagree with the payment records.
   */
  const stillOwed = claimStatus
    .filter((c) => c.is_reimbursable)
    .reduce((t, c) => t + Number(c.outstanding_amount), 0);
  const settledCount = claimStatus
    .filter((c) => c.reimbursement_status === 'reimbursed').length;
  const partCount = claimStatus
    .filter((c) => c.reimbursement_status === 'partially_reimbursed').length;

  /**
   * Rebuild the employee's own voucher from the stored payment. RLS restricts
   * both the payment and its lines to this employee.
   */
  /** Build the voucher and open it in the viewer; download is offered there. */
  async function viewVoucher(paymentId: string) {
    const payment = reimbursements.find((p) => p.id === paymentId);
    if (!payment || !employee) return;
    try {
      const [settings, items] = await Promise.all([
        settingsApi.get(),
        reimbursementApi.itemsFor(payment.id),
      ]);
      setViewingVoucher({
        kind: 'reimbursement',
        voucherNo: payment.voucher_no,
        paymentDate: payment.payment_date,
        amount: Number(payment.amount),
        paymentMode: payment.payment_mode,
        reference: payment.reference,
        notes: payment.notes,
        employee,
        settings,
        claims: items.map((it) => {
          const claim = expenses.find((x) => x.id === it.expense_id);
          return {
            date: claim?.expense_date ?? payment.payment_date,
            category: claim?.category ?? 'Expense',
            description: claim?.description ?? null,
            approved: Number(claim?.amount ?? it.amount),
            previouslyPaid: 0,
            paidNow: Number(it.amount),
            outstanding: Number(claim?.amount ?? it.amount) - Number(it.amount),
          };
        }),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the voucher');
    }
  }

  /** Load a pending claim into the form for editing. */
  function startEdit(e: CompanyExpense) {
    setEditingId(e.id);
    setDate(e.expense_date);
    setCategory(e.category);
    setAmount(String(e.amount));
    setBill(e.bill_number ?? '');
    setDescription(e.description ?? '');
    setClientId(e.client_id ?? '');
    setClientLocationId(e.client_location_id ?? '');
    setPaidFromAdvance(e.paid_from_advance);
    setReceipt(null);
    document.getElementById('expense-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setDate(isoDate(new Date())); setCategory(CATEGORIES[0]);
    setAmount(''); setBill(''); setDescription(''); setClientId('');
    setClientLocationId('');
    setPaidFromAdvance(false); setReceipt(null);
  }

  async function submit() {
    const amt = Number(amount);
    if (!date || !category || !Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a date, category and a valid amount.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await expenseApi.updateOwn(editingId, {
          expense_date: date, category, amount: amt,
          bill_number: bill || null, description: description || null,
          client_id: clientId || null,
          client_location_id: clientLocationId || null,
          paid_from_advance: outstanding > 0 ? paidFromAdvance : false,
        }, receipt);
      } else {
        await expenseApi.submit({
          employee_id: employeeId, expense_date: date, category, amount: amt,
          bill_number: bill || null, description: description || null,
          client_id: clientId || null,
          client_location_id: clientLocationId || null, receipt_url: null,
          paid_from_advance: outstanding > 0 ? paidFromAdvance : false,
        }, receipt);
      }
      toast.success(
        editingId
          ? (receipt ? 'Expense updated and receipt replaced.' : 'Expense updated.')
          : (receipt ? 'Expense and receipt submitted for approval.'
                     : 'Expense submitted for approval.'),
      );
      cancelEdit();
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not submit expense');
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<CompanyExpense>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.expense_date) },
    { key: 'cat', header: 'Category', cell: (r) => r.category },
    { key: 'amt', header: 'Amount', align: 'right', cell: (r) => formatCurrency(r.amount) },
    { key: 'bill', header: 'Bill no.', cell: (r) => r.bill_number || '—' },
    { key: 'desc', header: 'Description', cell: (r) => r.description || '—' },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    // Settlement is shown only for approved claims, and only from the derived
    // payment records — never inferred from approval alone.
    { key: 'settle', header: 'Reimbursement',
      cell: (r) => {
        const st = claimStatus.find((c) => c.expense_id === r.id);
        if (!st || r.status !== 'approved') return <span className="muted">—</span>;
        if (st.reimbursement_status === 'accounted_against_advance') {
          return <Badge tone="neutral-alt">Paid from advance</Badge>;
        }
        if (st.reimbursement_status === 'reimbursed') {
          return <Badge tone="success">Settled</Badge>;
        }
        if (st.reimbursement_status === 'partially_reimbursed') {
          return (
            <>
              <Badge tone="warn">Partially settled</Badge>
              <div className="muted small">
                {formatCurrency(st.outstanding_amount)} outstanding
              </div>
            </>
          );
        }
        return <Badge tone="info">Pending reimbursement</Badge>;
      } },
    { key: 'act', header: '', align: 'right',
      // Only a pending claim is editable; RLS enforces the same rule.
      cell: (r) => r.status === 'pending'
        ? (
          <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>Edit</Button>
        )
        : <span className="muted small">Locked</span> },
    { key: 'receipt', header: 'Receipt', align: 'right',
      cell: (r) => <ReceiptLink path={r.receipt_url} /> },
  ];

  return (
    <>
      <PageHeader title="Company expenses" subtitle="Raise and track your expense claims" />

      <Card
        id="expense-form"
        title={editingId ? 'Edit expense claim' : 'New expense claim'}
      >
        {editingId && (
          <p className="callout-warn">
            You are editing a pending claim. It can be changed until an admin
            approves it.
          </p>
        )}
        <div className="form-grid-2">
          <TextInput label="Date" type="date" value={date}
            onChange={(e) => setDate(e.target.value)} />
          <Select label="Category" value={category}
            onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div className="form-grid-2">
          <TextInput label="Amount (₹)" type="number" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
          <TextInput label="Bill number" value={bill}
            onChange={(e) => setBill(e.target.value)} placeholder="Optional" />
        </div>
        <Select label="Client (if applicable)" value={clientId}
          onChange={(e) => setClientId(e.target.value)}>
          <option value="">— No client —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <ClientLocationSelect clientId={clientId} value={clientLocationId}
          onChange={setClientLocationId} />
        <TextArea label="Description" value={description}
          onChange={(e) => setDescription(e.target.value)} placeholder="Optional details" />

        {/* Only meaningful when the employee actually holds company money.
            This is a hint for the admin — it does not decide the accounting. */}
        {outstanding > 0 && (
          <div className="advance-hint">
            <Checkbox
              label="I paid this from the company advance I am holding"
              checked={paidFromAdvance}
              onChange={(e) => setPaidFromAdvance(e.target.checked)}
            />
            <p className="field-hint">
              You currently hold {formatCurrency(outstanding)}. Ticking this tells
              the approver you used company money; they confirm the final accounting.
            </p>
          </div>
        )}
        <ReceiptPicker file={receipt} onChange={setReceipt} />
        <div className="btn-row">
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving
              ? (editingId ? 'Saving…' : 'Submitting…')
              : (editingId ? 'Save changes' : 'Submit expense')}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={cancelEdit}>Cancel edit</Button>
          )}
        </div>
      </Card>

      {(reimbursements.length > 0 || stillOwed > 0) && (
        <Card title="Reimbursements">
          <p className="muted small">
            Money the company has paid back to you for expenses you paid
            yourself. This is not salary — it does not appear on your salary
            slip and does not affect your pay.
          </p>

          <ul className="plain-list">
            <li>
              <span>Still to be reimbursed</span>
              <strong className={stillOwed > 0 ? 'count-pending' : undefined}>
                {formatCurrency(stillOwed)}
              </strong>
            </li>
            {partCount > 0 && (
              <li>
                <span>Claims partially settled</span>
                <strong>{partCount}</strong>
              </li>
            )}
            <li>
              <span>Claims fully settled</span>
              <strong>{settledCount}</strong>
            </li>
          </ul>

          {reimbursements.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher</th>
                    <th className="num">Amount</th>
                    <th>Mode / reference</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reimbursements.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.payment_date)}</td>
                      <td><strong>{p.voucher_no}</strong></td>
                      <td className="num">{formatCurrency(p.amount)}</td>
                      <td>
                        {p.payment_mode}
                        {p.reference && (
                          <div className="muted small">{p.reference}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Button size="sm" variant="ghost"
                          title="View voucher" aria-label="View voucher"
                          onClick={() => void viewVoucher(p.id)}>
                          <EyeIcon />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {viewingVoucher && (
        <PdfViewerModal
          title={`Payment voucher — ${viewingVoucher.voucherNo}`}
          build={() => generateVoucherPreview(viewingVoucher)}
          onClose={() => setViewingVoucher(null)}
          onDownload={() => void generateVoucherPdf(viewingVoucher)}
        />
      )}

      <Card title="My expense history">
        <DataTable columns={columns} rows={expenses} rowKey={(r) => r.id}
          empty="You have not submitted any expenses yet." />
      </Card>
    </>
  );
}
