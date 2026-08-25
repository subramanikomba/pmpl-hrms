import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { advanceApi, employeesApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, TextInput } from '@/components/ui/Field';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { LedgerRow } from '@/types/db';

export function CompanyAdvancePage() {
  const { employee } = useAuth();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const emps = useQuery(() => employeesApi.listActive(), []);
  const ledger = useQuery(
    () => employeeId ? advanceApi.ledgerFor(employeeId) : Promise.resolve([]),
    [employeeId],
  );

  const rows = ledger.data ?? [];
  const closing = rows.length > 0 ? (rows[rows.length - 1]?.running_balance ?? 0) : 0;

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
      cell: (r) => <Badge tone={r.txn_type === 'advance' ? 'info' : 'purple'}>
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
  ];

  return (
    <>
      <PageHeader
        title="Company advance & expense ledger"
        subtitle="Company money given to employees, and expenses accounted against it"
      />

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
  );
}
