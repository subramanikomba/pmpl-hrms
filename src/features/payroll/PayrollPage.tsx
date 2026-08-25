import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import {
  attendanceApi, employeesApi, holidayApi, payrollApi,
  salaryAdvanceApi, salaryApi, settingsApi,
} from '@/lib/api';
import {
  computePaidDays, computePayroll, daysInMonth, isPayrollMonthLocked,
  isoDate, monthStart, round2, structureForMonth,
} from '@/lib/payroll';
import { formatCurrency, formatMonth, monthInputValue, parseMonthInput } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/Field';
import type { Employee, PayrollRecord, SalaryStructure } from '@/types/db';

/** Per-employee editable inputs, keyed by employee id. */
interface RowEdits { paidDays: string; performance: string; annual: string; other: string }

export function PayrollPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [edits, setEdits] = useState<Record<string, RowEdits>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const month = parseMonthInput(monthValue) ?? monthStart(today);
  const dim = daysInMonth(month);

  const q = useQuery(async () => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [employees, existing, settings, holidays, attendance, structures, advances, recoveries] =
      await Promise.all([
        employeesApi.listActive(),
        payrollApi.listForMonth(month),
        settingsApi.get(),
        holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
        attendanceApi.listForMonth(month),
        Promise.all([] as Promise<SalaryStructure[]>[]).then(() => null),
        salaryAdvanceApi.listAll(),
        salaryAdvanceApi.recoveries(),
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
      structureMap, advances, recoveries,
    };
  }, [monthValue]);

  if (q.loading) return <Spinner label="Loading payroll…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  if (!q.data) return null;

  const {
    employees, existing, settings, holidays, attendance, structureMap,
    advances, recoveries,
  } = q.data;

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
      return {
        paidDays: String(existingRow.paid_days),
        performance: String(existingRow.performance_bonus),
        annual: String(existingRow.annual_bonus),
        other: String(existingRow.other_deductions),
      };
    }
    const records = attendance.filter((a) => a.employee_id === emp.id);
    const b = computePaidDays({ month, records, holidayDates });
    return { paidDays: String(b.paidDays), performance: '0', annual: '0', other: '0' };
  }

  function editsFor(emp: Employee): RowEdits {
    return edits[emp.id] ?? defaultsFor(emp);
  }

  function setEdit(empId: string, patch: Partial<RowEdits>) {
    setEdits((prev) => ({
      ...prev,
      [empId]: { ...(prev[empId] ?? { paidDays: '0', performance: '0', annual: '0', other: '0' }), ...patch },
    }));
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

    return {
      structure,
      recovery,
      result: computePayroll({
        structure,
        paidDays: Number(e.paidDays) || 0,
        daysInMonth: dim,
        performanceBonus: Number(e.performance) || 0,
        annualBonus: Number(e.annual) || 0,
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
                      <td className="num">{formatCurrency(allowances)}</td>
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
                    {rowLocked && row ? (
                      <Button size="sm" variant="ghost" onClick={() => void reopen(row)}>
                        Reopen
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary"
                        disabled={!computed || savingId === emp.id}
                        onClick={() => void save(emp)}>
                        {savingId === emp.id ? 'Saving…' : 'Save'}
                      </Button>
                    )}
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
