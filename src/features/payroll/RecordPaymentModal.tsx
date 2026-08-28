import { useState } from 'react';
import { payrollApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { formatCurrency, formatMonth } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Field';
import type { Employee, PayrollRecord } from '@/types/db';

/** Payment modes offered; "Other" keeps the field usable for anything else. */
const PAYMENT_MODES = [
  'Bank Transfer / NEFT',
  'Cheque',
  'Cash',
  'UPI',
  'Other',
] as const;

/**
 * Records how and when a processed payroll row was actually paid, moving it
 * to 'paid'. Purely a record of payment — no salary figure is recalculated.
 */
export function RecordPaymentModal(
  { record, employee, onClose, onDone }: {
    record: PayrollRecord;
    employee: Employee;
    onClose: () => void;
    onDone: () => void;
  },
) {
  const toast = useToast();
  const [date, setDate] = useState(record.payment_date ?? isoDate(new Date()));
  const [mode, setMode] = useState(record.payment_mode ?? PAYMENT_MODES[0]);
  const [ref, setRef] = useState(record.cheque_utr ?? '');
  const [saving, setSaving] = useState(false);

  // A reference is meaningless for cash, but expected for the rest.
  const refRequired = mode !== 'Cash';

  async function save() {
    if (!date) { toast.error('Enter the payment date.'); return; }
    if (!mode) { toast.error('Select a payment mode.'); return; }
    if (refRequired && !ref.trim()) {
      toast.error('Enter the cheque or UTR / reference number.');
      return;
    }
    setSaving(true);
    try {
      await payrollApi.recordPayment(record.id, {
        payment_date: date,
        payment_mode: mode,
        cheque_utr: ref.trim() || null,
      });
      toast.success(
        `Payment recorded for ${employee.first_name} ${employee.last_name}.`,
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the payment');
    } finally { setSaving(false); }
  }

  return (
    <Modal open title="Record payment" onClose={onClose} dismissOnBackdrop={false}>
      <p>
        <strong>{employee.employee_code} — {employee.first_name} {employee.last_name}</strong>
        <br />
        {formatMonth(record.payroll_month)} · Net payable{' '}
        <strong>{formatCurrency(record.net_salary)}</strong>
      </p>

      <div className="form-grid-2">
        <TextInput label="Payment date" type="date" value={date}
          onChange={(e) => setDate(e.target.value)} />
        <Select label="Payment mode" value={mode}
          onChange={(e) => setMode(e.target.value)}>
          {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </div>

      <TextInput
        label={mode === 'Cheque' ? 'Cheque number' : 'UTR / reference number'}
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        hint={refRequired
          ? 'Appears on the salary slip'
          : 'Optional for cash payments'}
      />

      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Mark as paid'}
        </Button>
      </div>
    </Modal>
  );
}
