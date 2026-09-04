import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { payrollApi, settingsApi } from '@/lib/api';
import { monthStart } from '@/lib/payroll';
import {
  formatCurrency, formatDate, formatMonth, monthInputValue, parseMonthInput,
} from '@/lib/format';
import { generatePdf, generatePdfPreview } from './slipDocument';
import { PdfViewerModal } from './PdfViewerModal';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { paymentStateFor } from '@/lib/payment';
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
  const [viewing, setViewing] = useState(false);

  const month = parseMonthInput(monthValue) ?? monthStart(today);
  const employeeId = employee?.id ?? '';

  const refs = useQuery(() => settingsApi.get(), []);
  const slip = useQuery(
    () => employeeId ? payrollApi.getOne(employeeId, month) : Promise.resolve(null),
    [employeeId, monthValue],
  );

  // A slip is a record of a payment made, so it appears only once the
  // payment has actually been recorded.
  const slipReady = slip.data?.status === 'paid' && !!slip.data.payment_date;
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
                {(() => {
                  // Paid only when a payment was actually recorded.
                  const settings = refs.data;
                  const p = slip.data!;
                  if (!settings) return null;
                  const dueDate = new Date(
                    month.getFullYear(), month.getMonth() + 1,
                    settings.salary_payment_day);
                  const state = paymentStateFor({
                    status: p.status, paymentDate: p.payment_date,
                    dueDate, today: new Date(),
                  });
                  const paid = state === 'paid';
                  return (
                    <>
                      <p className="slip-net">
                        {paid ? 'Net salary paid' : 'Net salary payable'}:{' '}
                        <strong>{formatCurrency(p.net_salary)}</strong>
                        {state !== 'not_processed' && (
                          <> <Badge tone={paid ? 'success'
                            : state === 'overdue' ? 'danger' : 'warn'}>
                            {paid ? 'Paid'
                              : state === 'overdue' ? 'Payment overdue' : 'Payable'}
                          </Badge></>
                        )}
                      </p>
                      {paid ? (
                        <>
                          <p>Payment date: {formatDate(p.payment_date)}</p>
                          {p.payment_mode && <p>Payment mode: {p.payment_mode}</p>}
                          {p.cheque_utr && <p>Reference: {p.cheque_utr}</p>}
                        </>
                      ) : state !== 'not_processed' && (
                        <p className={state === 'overdue' ? 'error-text' : undefined}>
                          Payment due date: {formatDate(dueDate)}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Employees get only a View action. The viewer itself provides
                  Download PDF and Close, so no separate download button is
                  offered here. Word (an editable format) is never offered. */}
              {slipReady ? (
                <div className="row-end gap">
                  <Button variant="primary" disabled={busy}
                    onClick={() => setViewing(true)}>View</Button>
                </div>
              ) : (
                <p className="callout-warn">
                  Your salary slip for {formatMonth(month)} will be available
                  once the payment has been recorded.
                </p>
              )}
            </>
          ) : (
            <p className="callout-warn">
              No salary slip is available for {formatMonth(month)} yet. Slips appear
              once payroll for that month has been processed and marked paid.
            </p>
          )}
      </Card>

      {viewing && slipReady && employee && refs.data && slip.data && (
        <PdfViewerModal
          title={`Salary slip — ${formatMonth(month)}`}
          build={() => generatePdfPreview({
            employee, payroll: slip.data!, settings: refs.data!, month,
          })}
          onClose={() => setViewing(false)}
          onDownload={() => void download('pdf')}
        />
      )}

      <p className="muted small">
        Salary slips are generated in your browser and are not stored on the server.
      </p>
    </>
  );
}
