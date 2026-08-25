import { useMemo, useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { employeesApi, payrollApi, settingsApi } from '@/lib/api';
import { monthStart } from '@/lib/payroll';
import { formatCurrency, formatMonth, monthInputValue, parseMonthInput } from '@/lib/format';
import { generateDocx, generatePdf } from './slipDocument';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, TextInput } from '@/components/ui/Field';

export function SalarySlipsPage() {
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const [employeeId, setEmployeeId] = useState('');
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [busy, setBusy] = useState(false);

  const month = parseMonthInput(monthValue) ?? monthStart(today);
  const refs = useQuery(async () => {
    const [employees, settings] = await Promise.all([
      employeesApi.listActive(), settingsApi.get(),
    ]);
    return { employees, settings };
  }, []);

  const preview = useQuery(
    () => employeeId ? payrollApi.getOne(employeeId, month) : Promise.resolve(null),
    [employeeId, monthValue],
  );

  async function download(kind: 'pdf' | 'docx') {
    const employee = refs.data?.employees.find((e) => e.id === employeeId);
    const settings = refs.data?.settings;
    const payroll = preview.data;
    if (!employee || !settings) return;
    if (!payroll) {
      toast.error('No payroll record exists for this employee and month.');
      return;
    }
    setBusy(true);
    try {
      const data = { employee, payroll, settings, month };
      if (kind === 'pdf') await generatePdf(data);
      else await generateDocx(data);
      toast.success(`Salary slip downloaded (${kind.toUpperCase()}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate the salary slip');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Salary slips" subtitle="Generate a PDF or Word salary slip" />

      <Card>
        <div className="form-grid-2">
          <Select label="Employee" value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select an employee…</option>
            {(refs.data?.employees ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
              </option>
            ))}
          </Select>
          <TextInput label="Month" type="month" value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)} />
        </div>

        {employeeId && (
          preview.loading ? <Spinner />
            : preview.data ? (
              <div className="slip-preview">
                <p><strong>{formatMonth(month)}</strong></p>
                <p>Paid days: {preview.data.paid_days} / {preview.data.days_in_month}</p>
                <p>Gross: {formatCurrency(preview.data.gross_salary)}</p>
                <p>Deductions: {formatCurrency(preview.data.total_deductions)}</p>
                <p className="slip-net">
                  Net payable: <strong>{formatCurrency(preview.data.net_salary)}</strong>
                </p>
              </div>
            ) : (
              <p className="callout-warn">
                No payroll has been processed for this employee in {formatMonth(month)}.
                Run payroll for that month first.
              </p>
            )
        )}

        <div className="row-end gap">
          <Button variant="secondary" disabled={busy || !preview.data}
            onClick={() => void download('docx')}>Download Word</Button>
          <Button variant="primary" disabled={busy || !preview.data}
            onClick={() => void download('pdf')}>Download PDF</Button>
        </div>
      </Card>

      <p className="muted small">
        Salary slips are generated in your browser and are not stored on the server.
      </p>
    </>
  );
}
