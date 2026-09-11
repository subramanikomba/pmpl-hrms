import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useToast } from '@/components/ui/ToastProvider';
import {
  PAYMENT_MAX_BYTES, PAYMENT_TYPES, reimbursementApi, settingsApi,
} from '@/lib/api';
import { isoDate, round2 } from '@/lib/payroll';
import { formatCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select, TextArea, TextInput } from '@/components/ui/Field';
import { generateVoucherPdf } from './voucherDocument';
import type { Employee, ExpenseReimbursementStatus } from '@/types/db';

const PAYMENT_MODES = [
  'Bank Transfer / NEFT', 'UPI', 'Cheque', 'Cash',
] as const;

/**
 * Record one reimbursement payment settling one or more approved claims.
 *
 * Admin enters the amount paid against each claim, so a claim may be settled
 * in full, in part, or across several payments. The amount actually paid is
 * the sum of those lines — it is never derived from the claims' approved
 * values, so a partial payment is recorded as exactly what was paid.
 */
export function RecordReimbursementModal(
  { employee, claims, onClose, onSaved }: {
    employee: Employee;
    /** Reimbursable claims for this employee. */
    claims: ExpenseReimbursementStatus[];
    onClose: () => void;
    onSaved: () => void;
  },
) {
  const { employee: admin } = useAuth();
  const toast = useToast();

  // Amount being paid against each claim, keyed by expense id.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const c of claims) seed[c.expense_id] = '';
    return seed;
  });
  const [date, setDate] = useState(isoDate(new Date()));
  const [mode, setMode] = useState<string>(PAYMENT_MODES[0]);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);

  const refRequired = mode !== 'Cash';

  const lines = claims
    .map((c) => ({ claim: c, amount: Number(amounts[c.expense_id] ?? 0) || 0 }))
    .filter((l) => l.amount > 0);
  const total = round2(lines.reduce((t, l) => t + l.amount, 0));

  /** Client-side twin of the database over-payment guard. */
  const overpaid = claims.filter((c) => {
    const a = Number(amounts[c.expense_id] ?? 0) || 0;
    return a > Number(c.outstanding_amount);
  });

  function fillAll() {
    const next: Record<string, string> = {};
    for (const c of claims) next[c.expense_id] = String(c.outstanding_amount);
    setAmounts(next);
  }

  async function save() {
    if (!admin) return;
    if (lines.length === 0) {
      toast.error('Enter an amount against at least one claim.'); return;
    }
    if (overpaid.length > 0) {
      toast.error('An amount is more than the claim’s outstanding balance.'); return;
    }
    if (refRequired && !reference.trim()) {
      toast.error('Enter the UTR or reference number.'); return;
    }

    setSaving(true);
    try {
      const settings = await settingsApi.get();
      const saved = await reimbursementApi.record({
        employee_id: employee.id,
        payment_date: date,
        payment_mode: mode,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          expense_id: l.claim.expense_id, amount: l.amount,
        })),
        proof,
        shared,
        paid_by: admin.id,
      });

      // The voucher is built from what was just recorded, so the totals on it
      // are the amounts actually paid.
      await generateVoucherPdf({
        kind: 'reimbursement',
        voucherNo: saved.voucher_no,
        paymentDate: saved.payment_date,
        amount: Number(saved.amount),
        paymentMode: saved.payment_mode,
        reference: saved.reference,
        notes: saved.notes,
        employee,
        settings,
        claims: lines.map((l) => ({
          date: l.claim.expense_date,
          category: l.claim.category,
          description: l.claim.description,
          approved: Number(l.claim.approved_amount),
          previouslyPaid: Number(l.claim.reimbursed_amount),
          paidNow: l.amount,
          outstanding: round2(Number(l.claim.outstanding_amount) - l.amount),
        })),
      });

      toast.success(`Reimbursement ${saved.voucher_no} recorded.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the payment');
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Record reimbursement — ${employee.first_name} ${employee.last_name}`}
      onClose={onClose}
      dismissOnBackdrop={false}
    >
      <p className="muted small">
        Enter the amount being paid against each claim. Leave a claim blank to
        pay nothing towards it, or enter less than the outstanding balance to
        pay it in part.
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th className="num">Approved</th>
              <th className="num">Already paid</th>
              <th className="num">Outstanding</th>
              <th className="num">Pay now</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => {
              const entered = Number(amounts[c.expense_id] ?? 0) || 0;
              const over = entered > Number(c.outstanding_amount);
              return (
                <tr key={c.expense_id}>
                  <td>{formatDate(c.expense_date)}</td>
                  <td>
                    {c.category}
                    {c.description && (
                      <div className="muted small">{c.description}</div>
                    )}
                  </td>
                  <td className="num">{formatCurrency(c.approved_amount)}</td>
                  <td className="num">{formatCurrency(c.reimbursed_amount)}</td>
                  <td className="num">{formatCurrency(c.outstanding_amount)}</td>
                  <td className="num">
                    <input
                      className="cell-input"
                      type="number" min="0" step="0.01"
                      max={Number(c.outstanding_amount)}
                      value={amounts[c.expense_id] ?? ''}
                      placeholder="0.00"
                      onChange={(e) => setAmounts((a) => ({
                        ...a, [c.expense_id]: e.target.value,
                      }))}
                    />
                    {over && (
                      <div className="error-text small">
                        Max {formatCurrency(c.outstanding_amount)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row-end gap">
        <Button size="sm" variant="ghost" onClick={fillAll}>
          Pay all outstanding
        </Button>
      </div>

      <p className="slip-net">
        Total being paid: <strong>{formatCurrency(total)}</strong>
      </p>

      <div className="form-grid-2">
        <TextInput label="Payment date" type="date" value={date}
          onChange={(e) => setDate(e.target.value)}
          hint="The date money actually moved. It may be later than the expense month." />
        <Select label="Payment mode" value={mode}
          onChange={(e) => setMode(e.target.value)}>
          {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </div>

      <TextInput
        label={mode === 'Cheque' ? 'Cheque number' : 'UTR / reference number'}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        hint={refRequired ? 'Appears on the voucher' : 'Optional for cash payments'}
      />

      <TextArea label="Notes (optional)" value={notes}
        onChange={(e) => setNotes(e.target.value)} />

      <TextInput
        label="Payment proof (optional)"
        type="file"
        accept={PAYMENT_TYPES.join(',')}
        autoComplete="off"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && f.size > PAYMENT_MAX_BYTES) {
            toast.error('The file must be 5 MB or smaller.');
            e.target.value = '';
            setProof(null);
            return;
          }
          setProof(f);
        }}
        hint="JPG, PNG or PDF, up to 5 MB."
      />

      {/* Opt-in, and enforced by RLS on the storage bucket, not just here. */}
      <label className="checkbox-row">
        <input type="checkbox" checked={shared}
          onChange={(e) => setShared(e.target.checked)} />
        <span>
          Share payment proof with employee
          <span className="radio-note">
            Leave unchecked to keep it visible to Admin only.
          </span>
        </span>
      </label>

      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || total <= 0}
          onClick={() => void save()}>
          {saving ? 'Recording…' : 'Record payment & download voucher'}
        </Button>
      </div>
    </Modal>
  );
}
