import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import {
  attendanceApi, employeesApi, holidayApi, payrollApi, rulesApi,
  salaryAdvanceApi, salaryApi, settingsApi,
} from '@/lib/api';
import {
  computeAllowanceAmount, computePaidDays, computePayroll, daysInMonth,
  isPayrollMonthLocked, isoDate, monthStart, round2, structureForMonth,
  type AllowanceLine,
} from '@/lib/payroll';
import { formatCurrency, formatDate, formatMonth, monthInputValue, parseMonthInput } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/Field';
import { RecordPaymentModal } from './RecordPaymentModal';
import { Modal } from '@/components/ui/Modal';
import type { Employee, PayrollRecord, SalaryStructure } from '@/types/db';

/** Per-employee editable inputs, keyed by employee id. */
interface RowEdits {
  paidDays: string; performance: string; annual: string; other: string;
  /** rule_key -> quantity entered by Admin for this month. */
  allowanceQty: Record<string, string>;
}

export function PayrollPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [edits, setEdits] = useState<Record<string, RowEdits>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [paying, setPaying] = useState<
    { record: PayrollRecord; employee: Employee } | null>(null);
  const [allowancesFor, setAllowancesFor] = useState<
    { employee: Employee; proratedBasic: number } | null>(null);

  const month = parseMonthInput(monthValue) ?? monthStart(today);
  const dim = daysInMonth(month);

  const q = useQuery(async () => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [employees, existing, settings, holidays, attendance, structures, advances, recoveries, rules] =
      await Promise.all([
        employeesApi.listActive(),
        payrollApi.listForMonth(month),
        settingsApi.get(),
        holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
        attendanceApi.listForMonth(month),
        Promise.all([] as Promise<SalaryStructure[]>[]).then(() => null),
        salaryAdvanceApi.listAll(),
        salaryAdvanceApi.recoveries(),
        rulesApi.list(),
      ]);
    // Salary structures are fetched per employee (small team; keeps the
    // query simple and respects RLS without a custom view).
    const structureMap = new Map<string, SalaryStructure[]>();
    await Promise.all(employees.map(async (e) => {
      structureMap.set(e.id, await salaryApi.listFor(e.id));
    }));
    void structures;
    return {
      employees, existing, settings, holidays, attendance,
      structureMap, advances, recoveries, rules,
    };
  }, [monthValue]);

  if (q.loading) return <Spinner label="Loading payroll…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  if (!q.data) return null;

  const {
    employees, existing, settings, holidays, attendance, structureMap,
    advances, recoveries, rules,
  } = q.data;
  const activeRules = rules.filter((r) => r.is_active);

  const monthLocked = isPayrollMonthLocked(month, settings.salary_payment_day, today);
  const holidayDates = new Set(holidays.map((h) => h.holiday_date));
  const payrollByEmployee = new Map(existing.map((p) => [p.employee_id, p] as const));

  // Outstanding salary advance per employee.
  const saGiven = new Map<string, number>();
  for (const a of advances) {
    saGiven.set(a.employee_id, (saGiven.get(a.employee_id) ?? 0) + Number(a.amount));
  }
  const saRecovered = new Map<string, number>();
  for (const r of recoveries) {
    saRecovered.set(r.employee_id, (saRecovered.get(r.employee_id) ?? 0) + Number(r.recovered_amount));
  }

  function defaultsFor(emp: Employee): RowEdits {
    const existingRow = payrollByEmployee.get(emp.id);
    if (existingRow) {
      // Rehydrate the quantities that produced the saved allowance total.
      const detail = Array.isArray(existingRow.allowances_detail)
        ? existingRow.allowances_detail as AllowanceLine[] : [];
      const qty: Record<string, string> = {};
      for (const line of detail) qty[line.rule_key] = String(line.quantity);
      return {
        paidDays: String(existingRow.paid_days),
        performance: String(existingRow.performance_bonus),
        annual: String(existingRow.annual_bonus),
        other: String(existingRow.other_deductions),
        allowanceQty: qty,
      };
    }
    const records = attendance.filter((a) => a.employee_id === emp.id);
    const b = computePaidDays({
      month, records, holidayDates, workingDays: settings.working_days });
    return { paidDays: String(b.paidDays), performance: '0', annual: '0',
             other: '0', allowanceQty: {} };
  }

  function editsFor(emp: Employee): RowEdits {
    return edits[emp.id] ?? defaultsFor(emp);
  }

  function defaultsForId(empId: string): RowEdits {
    const emp = employees.find((x) => x.id === empId);
    return emp
      ? defaultsFor(emp)
      : { paidDays: '0', performance: '0', annual: '0', other: '0', allowanceQty: {} };
  }

  function setEdit(empId: string, patch: Partial<RowEdits>) {
    setEdits((prev) => ({
      ...prev,
      [empId]: {
        // Fall back to the row's REAL defaults (paid days from attendance,
        // existing saved figures), never to a hard-coded zero row — otherwise
        // editing one field, such as an allowance quantity, would silently
        // reset paid days to 0 and understate the salary.
        ...(prev[empId] ?? defaultsForId(empId)),
        ...patch,
      },
    }));
  }

  /** Allowance lines from the configured rules and the Admin's quantities. */
  function allowanceLinesFor(emp: Employee, basic: number): AllowanceLine[] {
    const e = editsFor(emp);
    return activeRules.map((rule) => {
      const quantity = Number(e.allowanceQty[rule.rule_key] ?? 0) || 0;
      return {
        rule_key: rule.rule_key,
        description: rule.description,
        rate_percent: Number(rule.rate_percent),
        quantity,
        amount: computeAllowanceAmount(basic, Number(rule.rate_percent), quantity),
      };
    }).filter((l) => l.amount > 0);
  }

  function computeFor(emp: Employee) {
    const structure = structureForMonth(structureMap.get(emp.id) ?? [], month);
    if (!structure) return null;
    const e = editsFor(emp);
    const outstanding = round2(
      (saGiven.get(emp.id) ?? 0) - (saRecovered.get(emp.id) ?? 0),
    );
    const existingRow = payrollByEmployee.get(emp.id);
    // If payroll already recorded a recovery for this month, keep that figure
    // rather than recovering the same advance twice.
    const recovery = existingRow
      ? Number(existingRow.salary_advance_recovered)
      : Math.max(0, outstanding);

    // Allowances are a percentage of the PRORATED basic for the month.
    const proratedBasic = round2(structure.basic * (Math.min(Number(e.paidDays) || 0, dim) / dim));
    const allowanceLines = allowanceLinesFor(emp, proratedBasic);
    const allowancesTotal = round2(allowanceLines.reduce((t, l) => t + l.amount, 0));

    return {
      structure,
      recovery,
      allowanceLines,
      allowancesTotal,
      result: computePayroll({
        structure,
        paidDays: Number(e.paidDays) || 0,
        daysInMonth: dim,
        performanceBonus: Number(e.performance) || 0,
        annualBonus: Number(e.annual) || 0,
        allowancesTotal,
        professionalTax: month.getMonth() === 1 ? settings.pt_february : settings.pt_monthly,
        salaryAdvanceRecovered: recovery,
        otherDeductions: Number(e.other) || 0,
      }),
    };
  }

  async function save(emp: Employee) {
    if (!employee) return;
    const computed = computeFor(emp);
    if (!computed) {
      toast.error(`No salary structure defined for ${emp.first_name}.`);
      return;
    }
    const e = editsFor(emp);
    setSavingId(emp.id);
    try {
      const pt = month.getMonth() === 1 ? settings.pt_february : settings.pt_monthly;
      await payrollApi.save({
        employee_id: emp.id,
        payroll_month: isoDate(monthStart(month)),
        days_in_month: dim,
        paid_days: Number(e.paidDays) || 0,
        ...computed.result,
        allowances_total: computed.allowancesTotal,
        allowances_detail: computed.allowanceLines,
        performance_bonus: Number(e.performance) || 0,
        annual_bonus: Number(e.annual) || 0,
        professional_tax: pt,
        salary_advance_recovered: computed.recovery,
        other_deductions: Number(e.other) || 0,
        status: 'processed',
      });

      // Record the salary-advance recovery once, against the oldest advance.
      const alreadyRecorded = payrollByEmployee.has(emp.id);
      if (!alreadyRecorded && computed.recovery > 0) {
        const oldest = advances
          .filter((a) => a.employee_id === emp.id)
          .sort((a, b) => a.advance_date.localeCompare(b.advance_date))[0];
        if (oldest) {
          await salaryAdvanceApi.recordRecovery({
            salary_advance_id: oldest.id,
            employee_id: emp.id,
            payroll_month: isoDate(monthStart(month)),
            recovered_amount: computed.recovery,
          });
        }
      }

      toast.success(`Payroll saved for ${emp.first_name} ${emp.last_name}.`);
      q.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save payroll');
    } finally {
      setSavingId(null);
    }
  }

  /** Reverse a payment entry; the salary figures are untouched. */
  async function undoPayment(row: PayrollRecord, emp: Employee) {
    const ok = window.confirm(
      `Undo the recorded payment for ${emp.first_name} ${emp.last_name}?\n\n`
      + 'The payment date, mode and reference will be cleared and the record '
      + 'returns to Processed. Salary figures are not changed.',
    );
    if (!ok) return;
    try {
      await payrollApi.clearPayment(row.id);
      toast.info('Payment entry removed.');
      q.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not undo the payment');
    }
  }

  async function reopen(row: PayrollRecord) {
    if (!employee) return;
    const reason = window.prompt('Reason for reopening this payroll record:');
    if (!reason) return;
    try {
      await payrollApi.reopen(row.id, employee.id, reason);
      toast.success('Payroll record reopened.');
      q.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reopen payroll');
    }
  }

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle={`Monthly salary calculation — ${formatMonth(month)}`}
      />

      <Card title="Payroll month">
        <TextInput label="Month" type="month" value={monthValue}
          onChange={(e) => { setMonthValue(e.target.value); setEdits({}); }} />
        {monthLocked && (
          <p className="callout-warn">
            This payroll month is locked because the payment date
            ({settings.salary_payment_day}th of the following month) has passed.
            A saved record can still be reopened individually if a correction is needed.
          </p>
        )}
      </Card>

      {allowancesFor && (() => {
        const emp = allowancesFor.employee;
        const ed = editsFor(emp);
        // Captured from the row when the modal was opened, so it always
        // matches the figure the grid is showing.
        const proratedBasic = allowancesFor.proratedBasic;
        return (
          <Modal open size="md"
            title={`Allowances — ${emp.first_name} ${emp.last_name}`}
            onClose={() => setAllowancesFor(null)} dismissOnBackdrop={false}>
            <p className="muted small">
              Rates come from Payroll Settings. Enter the quantity for this month;
              each amount is that percentage of the prorated basic
              ({formatCurrency(proratedBasic)}).
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rule</th><th className="num">Rate</th>
                  <th>Quantity</th><th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {activeRules.map((rule) => {
                  const qty = Number(ed.allowanceQty[rule.rule_key] ?? 0) || 0;
                  const amt = computeAllowanceAmount(
                    proratedBasic, Number(rule.rate_percent), qty);
                  return (
                    <tr key={rule.rule_key}>
                      <td>{rule.description}</td>
                      <td className="num">{rule.rate_percent}%</td>
                      <td>
                        <input className="cell-input" type="number" min="0" step="0.5"
                          value={ed.allowanceQty[rule.rule_key] ?? ''}
                          placeholder="0"
                          onChange={(ev) => setEdit(emp.id, {
                            allowanceQty: {
                              ...ed.allowanceQty,
                              [rule.rule_key]: ev.target.value,
                            },
                          })} />
                      </td>
                      <td className="num">{formatCurrency(amt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="total-line">
              Total allowances:{' '}
              <strong>{formatCurrency(computeFor(emp)?.allowancesTotal ?? 0)}</strong>
            </p>
            <div className="row-end gap">
              <Button variant="primary" onClick={() => setAllowancesFor(null)}>
                Done
              </Button>
            </div>
          </Modal>
        );
      })()}

      {paying && (
        <RecordPaymentModal
          record={paying.record}
          employee={paying.employee}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); q.reload(); }}
        />
      )}

      <div className="table-scroll">
        <table className="payroll-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Paid days</th>
              <th className="num">Basic</th>
              <th className="num">HRA</th>
              <th className="num">Allowances</th>
              <th>Perf. bonus</th>
              <th>Annual bonus</th>
              <th className="num">Gross</th>
              <th className="num">PT</th>
              <th className="num">Adv. rec.</th>
              <th>Other ded.</th>
              <th className="num">Net pay</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const row = payrollByEmployee.get(emp.id);
              const computed = computeFor(emp);
              const e = editsFor(emp);
              const rowLocked = monthLocked && !!row && !row.is_reopened;
              const allowances = computed
                ? round2(
                  computed.result.special_allowance + computed.result.transport_allowance
                  + computed.result.medical_allowance + computed.result.conveyance_other)
                : 0;

              return (
                <tr key={emp.id}>
                  <td>
                    <strong>{emp.employee_code}</strong>
                    <div className="emp-name">{emp.first_name} {emp.last_name}</div>
                  </td>
                  <td>
                    <input className="cell-input" type="number" min="0" max={dim} step="0.5"
                      value={e.paidDays} disabled={rowLocked}
                      onChange={(ev) => setEdit(emp.id, { paidDays: ev.target.value })} />
                    <span className="muted"> / {dim}</span>
                  </td>
                  {computed ? (
                    <>
                      <td className="num">{formatCurrency(computed.result.basic)}</td>
                      <td className="num">{formatCurrency(computed.result.hra)}</td>
                      <td className="num">
                        {formatCurrency(allowances + (computed?.allowancesTotal ?? 0))}
                        {activeRules.length > 0 && !rowLocked && (
                          <button className="link-btn"
                            onClick={() => setAllowancesFor({
                              employee: emp,
                              proratedBasic: computed?.result.basic ?? 0,
                            })}
                            title="Enter allowance quantities">
                            {(computed?.allowancesTotal ?? 0) > 0 ? 'edit' : 'add'}
                          </button>
                        )}
                      </td>
                    </>
                  ) : (
                    <td className="num muted" colSpan={3}>No salary structure</td>
                  )}
                  <td>
                    <input className="cell-input" type="number" min="0" step="0.01"
                      value={e.performance} disabled={rowLocked}
                      onChange={(ev) => setEdit(emp.id, { performance: ev.target.value })} />
                  </td>
                  <td>
                    <input className="cell-input" type="number" min="0" step="0.01"
                      value={e.annual} disabled={rowLocked}
                      onChange={(ev) => setEdit(emp.id, { annual: ev.target.value })} />
                  </td>
                  <td className="num">
                    {computed ? formatCurrency(computed.result.gross_salary) : '—'}
                  </td>
                  <td className="num">
                    {formatCurrency(month.getMonth() === 1 ? settings.pt_february : settings.pt_monthly)}
                  </td>
                  <td className="num">{computed ? formatCurrency(computed.recovery) : '—'}</td>
                  <td>
                    <input className="cell-input" type="number" min="0" step="0.01"
                      value={e.other} disabled={rowLocked}
                      onChange={(ev) => setEdit(emp.id, { other: ev.target.value })} />
                  </td>
                  <td className="num fw-bold">
                    {computed ? formatCurrency(computed.result.net_salary) : '—'}
                  </td>
                  <td><StatusBadge status={row?.status ?? 'draft'} /></td>
                  <td>
                    <div className="row-actions">
                      {row?.status === 'paid' ? (
                        <>
                          <span className="paid-ref" title={
                            `${row.payment_mode ?? ''}${row.cheque_utr ? ' · ' + row.cheque_utr : ''}`
                          }>
                            {formatDate(row.payment_date)}
                          </span>
                          <Button size="sm" variant="ghost"
                            onClick={() => void undoPayment(row, emp)}>Undo</Button>
                        </>
                      ) : rowLocked && row ? (
                        <Button size="sm" variant="ghost" onClick={() => void reopen(row)}>
                          Reopen
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="primary"
                            disabled={!computed || savingId === emp.id}
                            onClick={() => void save(emp)}>
                            {savingId === emp.id ? 'Saving…' : 'Save'}
                          </Button>
                          {row?.status === 'processed' && (
                            <Button size="sm" variant="secondary"
                              onClick={() => setPaying({ record: row, employee: emp })}>
                              Pay
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
