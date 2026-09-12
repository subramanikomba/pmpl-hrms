import { useMemo, useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { employeesApi, payrollApi, settingsApi } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { paymentStateFor } from '@/lib/payment';
import { monthStart } from '@/lib/payroll';
import { formatCurrency, formatDate, formatMonth, monthInputValue, parseMonthInput } from '@/lib/format';
import {
  generateDocx, generatePdf, generatePdfBytes, generatePdfPreview,
} from './slipDocument';
import { PdfViewerModal } from './PdfViewerModal';
import { PaymentAttachment } from './PaymentAttachment';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, EyeIcon } from '@/components/ui/Icons';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, TextInput } from '@/components/ui/Field';

export function SalarySlipsPage() {
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const [employeeId, setEmployeeId] = useState('');
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // A salary slip is a record of a payment made, so it is only issued once
  // the payment has actually been recorded — not merely processed.
  const slipReady = preview.data?.status === 'paid'
    && !!preview.data.payment_date;
  // Everything the generator needs, or null when the selection is incomplete.
  const slipData = (() => {
    const employee = refs.data?.employees.find((e) => e.id === employeeId);
    const settings = refs.data?.settings;
    const payroll = preview.data;
    return employee && settings && payroll
      ? { employee, payroll, settings, month }
      : null;
  })();

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

  /**
   * One ZIP of PDF slips for every employee PAID in the selected month.
   * Reuses the same generator as the single download, so a bulk slip is
   * byte-identical to the individual one. Unpaid months are skipped, since a
   * slip is only issued once the payment is recorded.
   */
  async function downloadAll() {
    const settings = refs.data?.settings;
    const employees = refs.data?.employees ?? [];
    if (!settings) return;

    setBulkBusy(true);
    try {
      const rows = await payrollApi.listForMonth(month);
      const payable = rows.filter(
        (r) => r.status === 'paid' && r.payment_date);

      if (payable.length === 0) {
        toast.error(
          `No salary slips are available for ${formatMonth(month)}. `
          + 'Slips appear once payments have been recorded.',
        );
        return;
      }

      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      let added = 0;

      for (const payroll of payable) {
        const employee = employees.find((e) => e.id === payroll.employee_id);
        if (!employee) continue; // inactive employee not in the active list
        const bytes = await generatePdfBytes({ employee, payroll, settings, month });
        const name = `${employee.first_name}_${employee.last_name}`
          .replace(/\s+/g, '_');
        const monthName = formatMonth(month).replace(/\s+/g, '_');
        zip.file(`${employee.employee_code}_${name}_${monthName}.pdf`, bytes);
        added++;
      }

      if (added === 0) {
        toast.error('No salary slips could be generated for this month.');
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Salary_Slips_${formatMonth(month).replace(/\s+/g, '_')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${added} salary slip${added === 1 ? '' : 's'} downloaded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the ZIP file');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Salary slips" subtitle="Generate a PDF or Word salary slip" />

      <Card>
        {/* Month first: Admin picks the period, then who within it. Kept on
            one compact row; the month field is narrow so the two sit together
            rather than spanning the card. */}
        <div className="filter-row">
          <TextInput label="Month" type="month" value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)} />
          <Select label="Employee" value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select an employee…</option>
            {(refs.data?.employees ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
              </option>
            ))}
          </Select>
        </div>

        {employeeId && (
          preview.loading ? <Spinner />
            : preview.data ? (
              <div className="slip-preview">
                <p><strong>{formatMonth(month)}</strong></p>
                <p>Paid days: {preview.data.paid_days} / {preview.data.days_in_month}</p>
                <p>Gross: {formatCurrency(preview.data.gross_salary)}</p>
                <p>Deductions: {formatCurrency(preview.data.total_deductions)}</p>
                {(() => {
                  // Payment status comes from the payment record, never from
                  // payroll being calculated, finalised or a slip generated.
                  const settings = refs.data?.settings;
                  if (!settings) return null;
                  const dueDate = new Date(
                    month.getFullYear(), month.getMonth() + 1,
                    settings.salary_payment_day);
                  const state = paymentStateFor({
                    status: preview.data.status,
                    paymentDate: preview.data.payment_date,
                    dueDate,
                    today: new Date(),
                  });
                  const paid = state === 'paid';
                  return (
                    <>
                      <p className="slip-net">
                        {paid ? 'Net salary paid' : 'Net salary payable'}:{' '}
                        <strong>{formatCurrency(preview.data.net_salary)}</strong>
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
                          <p>Payment date: {formatDate(preview.data.payment_date)}</p>
                          {preview.data.payment_mode && (
                            <p>Payment mode: {preview.data.payment_mode}</p>
                          )}
                          {preview.data.cheque_utr && (
                            <p>Reference: {preview.data.cheque_utr}</p>
                          )}
                          <PaymentAttachment record={preview.data} isAdmin
                            onChanged={preview.reload} />
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
            ) : (
              <p className="callout-warn">
                No payroll has been processed for this employee in {formatMonth(month)}.
                Run payroll for that month first.
              </p>
            )
        )}

        {preview.data && !slipReady && (
          <p className="callout-warn">
            The salary slip becomes available once this month's payment has been
            recorded. Record the payment from the Payroll screen.
          </p>
        )}
        {/* View is the primary action; the two file formats sit behind one
            Download control so the row is not three competing buttons. */}
        <div className="row-end gap">
          <div className="dropdown">
            <Button variant="secondary" disabled={busy || !slipReady}
              onClick={() => setDownloadOpen((o) => !o)}
              aria-expanded={downloadOpen} aria-haspopup="menu">
              <DownloadIcon /> Download
            </Button>
            {downloadOpen && slipReady && (
              <div className="dropdown-menu" role="menu">
                <button role="menuitem"
                  onClick={() => { setDownloadOpen(false); void download('pdf'); }}>
                  PDF
                </button>
                <button role="menuitem"
                  onClick={() => { setDownloadOpen(false); void download('docx'); }}>
                  Word
                </button>
              </div>
            )}
          </div>
          <Button variant="primary" disabled={busy || !slipReady}
            onClick={() => setViewing(true)}>
            <EyeIcon /> View
          </Button>
        </div>
      </Card>

      <Card title={`All salary slips — ${formatMonth(month)}`}>
        <p className="muted small">
          Downloads one ZIP containing a PDF slip for every employee whose
          payment for this month has been recorded. Word files are not included.
        </p>
        <div className="row-end gap">
          <Button variant="secondary" disabled={bulkBusy}
            onClick={() => void downloadAll()}>
            {bulkBusy ? 'Preparing…' : 'Download all salary slips (ZIP)'}
          </Button>
        </div>
      </Card>

      {viewing && slipData && (
        <PdfViewerModal
          title={`Salary slip — ${formatMonth(month)}`}
          build={() => generatePdfPreview(slipData)}
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