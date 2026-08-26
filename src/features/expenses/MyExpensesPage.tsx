import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { advanceApi, clientApi, expenseApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
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
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [paidFromAdvance, setPaidFromAdvance] = useState(false);

  const q = useQuery(async () => {
    const [expenses, clients, ledger] = await Promise.all([
      expenseApi.listFor(employeeId),
      clientApi.list(true),
      advanceApi.ledgerFor(employeeId),
    ]);
    const outstanding = ledger.length > 0
      ? Number(ledger[ledger.length - 1]?.running_balance ?? 0) : 0;
    return { expenses, clients, outstanding };
  }, [employeeId]);

  if (q.loading) return <Spinner label="Loading expenses…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  const { expenses = [], clients = [], outstanding = 0 } = q.data ?? {};

  async function submit() {
    const amt = Number(amount);
    if (!date || !category || !Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a date, category and a valid amount.');
      return;
    }
    setSaving(true);
    try {
      await expenseApi.submit({
        employee_id: employeeId, expense_date: date, category, amount: amt,
        bill_number: bill || null, description: description || null,
        client_id: clientId || null, receipt_url: null,
        paid_from_advance: outstanding > 0 ? paidFromAdvance : false,
      }, receipt);
      toast.success(
        receipt ? 'Expense and receipt submitted for approval.'
                : 'Expense submitted for approval.',
      );
      setAmount(''); setBill(''); setDescription(''); setClientId('');
      setPaidFromAdvance(false); setReceipt(null);
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
    { key: 'receipt', header: 'Receipt', align: 'right',
      cell: (r) => <ReceiptLink path={r.receipt_url} /> },
  ];

  return (
    <>
      <PageHeader title="Company expenses" subtitle="Raise and track your expense claims" />

      <Card title="New expense claim">
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
        <Button variant="primary" disabled={saving} onClick={() => void submit()}>
          Submit expense
        </Button>
      </Card>

      <Card title="My expense history">
        <DataTable columns={columns} rows={expenses} rowKey={(r) => r.id}
          empty="You have not submitted any expenses yet." />
      </Card>
    </>
  );
}
