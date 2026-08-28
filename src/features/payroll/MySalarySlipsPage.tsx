import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { payrollApi, settingsApi } from '@/lib/api';
import { monthStart } from '@/lib/payroll';
import {
  formatCurrency, formatDate, formatMonth, monthInputValue, parseMonthInput,
} from '@/lib/format';
import { generatePdf } from './slipDocument';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/Field';

/**
 * An employee's own salary slips.
 *
 * Read-only by construction: nothing here writes to payroll. The employee can
 * only ever see their own record, and only once it is marked paid — enforced
 * by the `pay_own_read` RLS policy (employee_id = self AND status = 'paid'),
 * not by this component.
 */
export function MySalarySlipsPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [busy, setBusy] = useState(false);

  const month = parseMonthInput(monthValue) ?? monthStart(today);
  const employeeId = employee?.id ?? '';

  const refs = useQuery(() => settingsApi.get(), []);
  const slip = useQuery(
    () => employeeId ? payrollApi.getOne(employeeId, month) : Promise.resolve(null),
    [employeeId, monthValue],
  );

  /** PDF only — employees receive a non-editable document. */
  async function download(kind: 'pdf') {
    const settings = refs.data;
    const payroll = slip.data;
    if (!employee || !settings || !payroll) return;
    setBusy(true);
    try {
      await generatePdf({ employee, payroll, settings, month });
      toast.success(`Salary slip downloaded (${kind.toUpperCase()}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate the salary slip');
    } finally { setBusy(false); }
  }

  if (!employee) return null;

  return (
    <>
      <PageHeader
        title="My salary slips"
        subtitle="Your salary slips become available once payroll for the month is paid"
      />

      <Card className="mid">
        <TextInput label="Salary month" type="month" value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)} />

        {slip.loading ? <Spinner label="Looking for your salary slip…" />
          : slip.error ? <p className="error-text">{slip.error}</p>
          : slip.data ? (
            <>
              <div className="slip-preview">
                <p><strong>{formatMonth(month)}</strong></p>
                <p>Days paid: {slip.data.paid_days} / {slip.data.days_in_month}</p>
                <p>Gross salary: {formatCurrency(slip.data.gross_salary)}</p>
                <p>Total deductions: {formatCurrency(slip.data.total_deductions)}</p>
                <p className="slip-net">
                  Net salary payable: <strong>{formatCurrency(slip.data.net_salary)}</strong>
                </p>
                {slip.data.payment_date && (
                  <p className="muted small">
                    Paid on {formatDate(slip.data.payment_date)}
                    {slip.data.payment_mode ? ` · ${slip.data.payment_mode}` : ''}
                    {slip.data.cheque_utr ? ` · ${slip.data.cheque_utr}` : ''}
                  </p>
                )}
              </div>

              {/* PDF only for employees: a non-editable document. Word is an
                  editable format, so it is deliberately not offered here. */}
              <div className="row-end gap">
                <Button variant="primary" disabled={busy}
                  onClick={() => void download('pdf')}>Download PDF</Button>
              </div>
            </>
          ) : (
            <p className="callout-warn">
              No salary slip is available for {formatMonth(month)} yet. Slips appear
              once payroll for that month has been processed and marked paid.
            </p>
          )}
      </Card>

      <p className="muted small">
        Salary slips are generated in your browser and are not stored on the server.
      </p>
    </>
  );
}
