import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { employeesApi, salaryAdvanceApi } from '@/lib/api';
import { formatCurrency, formatDate, formatMonth } from '@/lib/format';
import { isoDate, round2 } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, TextInput } from '@/components/ui/Field';
import { DataTable, type Column } from '@/components/ui/DataTable';

interface LedgerLine {
  key: string; date: string; type: string;
  given: number; recovered: number; note: string; balance: number;
}

export function SalaryAdvancePage() {
  const { employee } = useAuth();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const emps = useQuery(() => employeesApi.listActive(), []);

  const summary = useQuery(async () => {
    const [advances, recoveries, employees] = await Promise.all([
      salaryAdvanceApi.listAll(),
      salaryAdvanceApi.recoveries(),
      employeesApi.listActive(),
    ]);
    const nameOf = new Map(employees.map((e) => [e.id, e] as const));
    const totals = new Map<string, { given: number; recovered: number }>();
    for (const a of advances) {
      const t = totals.get(a.employee_id) ?? { given: 0, recovered: 0 };
      t.given += Number(a.amount);
      totals.set(a.employee_id, t);
    }
    for (const r of recoveries) {
      const t = totals.get(r.employee_id) ?? { given: 0, recovered: 0 };
      t.recovered += Number(r.recovered_amount);
      totals.set(r.employee_id, t);
    }
    return [...totals.entries()].map(([id, t]) => ({
      id,
      employee: nameOf.get(id),
      given: round2(t.given),
      recovered: round2(t.recovered),
      outstanding: round2(t.given - t.recovered),
    }));
  }, [saving]);

  const [tab, setTab] = useState<'advances' | 'summary'>('advances');
  const ledger = useQuery(async (): Promise<LedgerLine[]> => {
    if (!employeeId) return [];
    const [advances, recoveries] = await Promise.all([
      salaryAdvanceApi.listFor(employeeId),
      salaryAdvanceApi.recoveries(employeeId),
    ]);
    const lines = [
      ...advances.map((a) => ({
        key: `a-${a.id}`, date: a.advance_date, type: 'Advance given',
        given: Number(a.amount), recovered: 0, note: a.note ?? '',
      })),
      ...recoveries.map((r) => ({
        key: `r-${r.id}`, date: r.payroll_month, type: 'Recovered via payroll',
        given: 0, recovered: Number(r.recovered_amount),
        note: `Payroll ${formatMonth(r.payroll_month)}`,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    let running = 0;
    return lines.map((l) => {
      running = round2(running + l.given - l.recovered);
      return { ...l, balance: running };
    });
  }, [employeeId, saving]);

  async function give() {
    if (!employee || !employeeId) { toast.error('Select an employee first.'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      await salaryAdvanceApi.give({
        employee_id: employeeId, advance_date: date, amount: amt,
        note, given_by: employee.id,
      });
      toast.success('Salary advance recorded.');
      setAmount(''); setNote('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record salary advance');
    } finally {
      setSaving(false);
    }
  }

  const ledgerCols: Column<LedgerLine>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.date) },
    { key: 'type', header: 'Type', cell: (r) => r.type },
    { key: 'given', header: 'Given', align: 'right',
      cell: (r) => r.given > 0 ? formatCurrency(r.given) : '—' },
    { key: 'rec', header: 'Recovered', align: 'right',
      cell: (r) => r.recovered > 0 ? formatCurrency(r.recovered) : '—' },
    { key: 'note', header: 'Note', cell: (r) => r.note || '—' },
    { key: 'bal', header: 'Balance', align: 'right',
      cell: (r) => <strong>{formatCurrency(r.balance)}</strong> },
  ];

  return (
    <>
      <PageHeader
        title="Salary advance"
        subtitle="Kept separate from company advances; recovered through payroll"
      />

      <div className="tabbar" role="tablist" aria-label="Salary advance views">
        <button role="tab" aria-selected={tab === 'advances'}
          className={`tab ${tab === 'advances' ? 'is-active' : ''}`}
          onClick={() => setTab('advances')}>
          Advances &amp; ledger
        </button>
        <button role="tab" aria-selected={tab === 'summary'}
          className={`tab ${tab === 'summary' ? 'is-active' : ''}`}
          onClick={() => setTab('summary')}>
          Outstanding summary
        </button>
      </div>

      {tab === 'summary' ? (
      <Card title="Outstanding — all employees">
        {summary.loading ? <Spinner /> : (
          <DataTable
            columns={[
              { key: 'emp', header: 'Employee',
                cell: (r: { employee?: { employee_code: string; first_name: string; last_name: string } }) =>
                  r.employee ? `${r.employee.employee_code} — ${r.employee.first_name} ${r.employee.last_name}` : '—' },
              { key: 'given', header: 'Given', align: 'right',
                cell: (r: { given: number }) => formatCurrency(r.given) },
              { key: 'rec', header: 'Recovered', align: 'right',
                cell: (r: { recovered: number }) => formatCurrency(r.recovered) },
              { key: 'out', header: 'Outstanding', align: 'right',
                cell: (r: { outstanding: number }) => (
                  <strong className={r.outstanding > 0 ? 'text-warn' : ''}>
                    {formatCurrency(r.outstanding)}
                  </strong>
                ) },
            ]}
            rows={summary.data ?? []}
            rowKey={(r) => r.id}
            empty="No salary advances on record."
          />
        )}
      </Card>
      ) : (<>
      <Card title="Give a salary advance">
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
          <TextInput label="Note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Purpose" />
        </div>
        <Button variant="primary" disabled={saving || !employeeId}
          onClick={() => void give()}>Record salary advance</Button>
      </Card>

      {employeeId && (
        <Card title="Employee ledger">
          {ledger.loading ? <Spinner /> : (
            <DataTable columns={ledgerCols} rows={ledger.data ?? []} rowKey={(r) => r.key}
              empty="No salary advance activity for this employee." />
          )}
        </Card>
      )}
    </>)}
    </>
  );
}
