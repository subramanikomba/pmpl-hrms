import { useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { clientApi, employeesApi, expenseApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { isoDate, monthStart } from '@/lib/payroll';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
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
  const [from, setFrom] = useState(isoDate(monthStart(now)));
  const [to, setTo] = useState(isoDate(new Date(now.getFullYear(), now.getMonth()+1, 0)));
  const [applied, setApplied] = useState(0);

  const refs = useQuery(async () => {
    const [emps, clients] = await Promise.all([employeesApi.listActive(), clientApi.list()]);
    return { emps, clients };
  }, []);

  const q = useQuery(() => expenseApi.listAll({
    employeeId: employeeId || undefined,
    category: category || undefined,
    clientId: clientId || undefined,
    status: (status || undefined) as CompanyExpense['status'] | undefined,
    from: from || undefined,
    to: to || undefined,
  }), [applied]);

  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const approvedTotal = rows.filter((r) => r.status === 'approved')
    .reduce((s, r) => s + Number(r.amount), 0);

  const byCategory = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'approved') continue;
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + Number(r.amount));
  }

  const columns: Column<WithEmployee<CompanyExpense>>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.expense_date) },
    { key: 'emp', header: 'Employee',
      cell: (r) => `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim() || '—' },
    { key: 'cat', header: 'Category', cell: (r) => r.category },
    { key: 'amt', header: 'Amount', align: 'right', cell: (r) => formatCurrency(r.amount) },
    { key: 'bill', header: 'Bill no.', cell: (r) => r.bill_number || '—' },
    { key: 'desc', header: 'Description', cell: (r) => r.description || '—' },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'acct', header: 'Accounted', align: 'right',
      cell: (r) => r.accounted_advance_id ? formatCurrency(r.accounted_amount ?? 0) : '—' },
    { key: 'receipt', header: 'Receipt', align: 'right',
      cell: (r) => <ReceiptLink path={r.receipt_url} /> },
  ];

  return (
    <>
      <PageHeader title="Expense reports" subtitle="Filter and review company expenses" />

      <Card title="Filters">
        <div className="form-grid-2">
          <Select label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All employees</option>
            {(refs.data?.emps ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
            ))}
          </Select>
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div className="form-grid-2">
          <Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {(refs.data?.clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
        </div>
        <div className="form-grid-2">
          <TextInput label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextInput label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="primary" onClick={() => setApplied((n) => n + 1)}>Apply filters</Button>
      </Card>

      {q.loading ? <Spinner label="Loading expenses…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : (
          <>
            <div className="stat-grid">
              <StatCard label="Claims" value={rows.length} />
              <StatCard label="Total amount" value={formatCurrency(total)} />
              <StatCard label="Approved amount" value={formatCurrency(approvedTotal)} tone="good" />
            </div>

            {byCategory.size > 0 && (
              <Card title="Approved by category">
                <div className="chip-row">
                  {[...byCategory.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat, amt]) => (
                      <span key={cat} className="chip">{cat}: {formatCurrency(amt)}</span>
                    ))}
                </div>
              </Card>
            )}

            <Card>
              <DataTable
                columns={columns} rows={rows} rowKey={(r) => r.id}
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
