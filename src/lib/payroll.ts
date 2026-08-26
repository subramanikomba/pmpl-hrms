/**
 * Pure payroll & attendance rules from the Phase 1 specification.
 *
 * Deliberately free of React, Supabase and DOM dependencies so the rules that
 * decide people's salaries can be unit-tested in isolation.
 */
import type {
  AttendanceRecord, AttendanceStatus, CompanySettings, SalaryStructure,
} from '@/types/db';

/** Round to 2 decimals, avoiding binary float drift (e.g. 1.005 -> 1.01). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function daysInMonth(month: Date): number {
  return new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
}

/** Local-time ISO date (YYYY-MM-DD). Avoids the UTC shift of toISOString(). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Spec: Professional Tax is 200/month, 300 in February. */
export function professionalTaxFor(
  month: Date,
  settings: Pick<CompanySettings, 'pt_monthly' | 'pt_february'>,
): number {
  return month.getMonth() === 1 ? settings.pt_february : settings.pt_monthly;
}

export interface PaidDayBreakdown {
  present: number;
  paidLeave: number;
  weeklyOffs: number;
  companyHolidays: number;
  absent: number;
  paidDays: number;
}

/**
 * Spec: working days are Mon–Sat; Sunday is a paid weekly off; configured
 * company holidays are paid. Paid Days = Present + Paid Leave + paid
 * weekly-offs + paid holidays.
 *
 * `upTo` bounds counting to days that have actually occurred, so a
 * mid-month view does not count future days as absent.
 */
export function computePaidDays(params: {
  month: Date;
  records: Pick<AttendanceRecord, 'date' | 'status'>[];
  holidayDates: ReadonlySet<string>;
  upTo?: Date;
}): PaidDayBreakdown {
  const { month, records, holidayDates } = params;
  const total = daysInMonth(month);
  const byDate = new Map<string, AttendanceStatus>();
  for (const r of records) byDate.set(r.date, r.status);

  const upTo = params.upTo ? isoDate(params.upTo) : null;

  let present = 0, paidLeave = 0, weeklyOffs = 0, companyHolidays = 0, absent = 0;

  for (let day = 1; day <= total; day++) {
    const d = new Date(month.getFullYear(), month.getMonth(), day);
    const ds = isoDate(d);
    if (upTo && ds > upTo) continue;

    const status = byDate.get(ds);

    // Sunday is always a paid weekly off, regardless of any stray record.
    if (d.getDay() === 0) { weeklyOffs++; continue; }
    if (status === 'present') { present++; continue; }
    if (status === 'paid_leave') { paidLeave++; continue; }
    if (holidayDates.has(ds) || status === 'company_holiday') { companyHolidays++; continue; }
    if (status === 'weekly_off') { weeklyOffs++; continue; }
    absent++;
  }

  return {
    present, paidLeave, weeklyOffs, companyHolidays, absent,
    paidDays: present + paidLeave + weeklyOffs + companyHolidays,
  };
}

export interface PayrollInput {
  structure: Pick<SalaryStructure,
    'basic' | 'hra' | 'special_allowance' | 'transport_allowance'
    | 'medical_allowance' | 'conveyance_other'>;
  paidDays: number;
  daysInMonth: number;
  performanceBonus: number;
  annualBonus: number;
  professionalTax: number;
  salaryAdvanceRecovered: number;
  otherDeductions: number;
}

export interface PayrollComputation {
  basic: number;
  hra: number;
  special_allowance: number;
  transport_allowance: number;
  medical_allowance: number;
  conveyance_other: number;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
}

/**
 * Spec: Gross = prorated fixed components + Performance Bonus + Annual Bonus.
 * Fixed components prorate on paidDays/daysInMonth; bonuses never prorate.
 */
export function computePayroll(input: PayrollInput): PayrollComputation {
  const { structure: s, paidDays, daysInMonth: dim } = input;
  const ratio = dim > 0 ? Math.min(paidDays, dim) / dim : 0;

  const basic = round2(s.basic * ratio);
  const hra = round2(s.hra * ratio);
  const special_allowance = round2(s.special_allowance * ratio);
  const transport_allowance = round2(s.transport_allowance * ratio);
  const medical_allowance = round2(s.medical_allowance * ratio);
  const conveyance_other = round2(s.conveyance_other * ratio);

  const gross_salary = round2(
    basic + hra + special_allowance + transport_allowance +
    medical_allowance + conveyance_other +
    input.performanceBonus + input.annualBonus,
  );

  const total_deductions = round2(
    input.professionalTax + input.salaryAdvanceRecovered + input.otherDeductions,
  );

  return {
    basic, hra, special_allowance, transport_allowance,
    medical_allowance, conveyance_other,
    gross_salary, total_deductions,
    net_salary: round2(gross_salary - total_deductions),
  };
}

/**
 * Spec: salary is paid on the 10th of the following month; a payroll month
 * locks once that date has passed. Admin may explicitly reopen a record.
 */
export function isPayrollMonthLocked(
  payrollMonth: Date,
  paymentDay = 10,
  now: Date = new Date(),
): boolean {
  const lockDate = new Date(
    payrollMonth.getFullYear(), payrollMonth.getMonth() + 1, paymentDay,
    23, 59, 59, 999,
  );
  return now > lockDate;
}

/**
 * Pick the salary structure in force for a given month: the latest revision
 * whose effective_from is on or before that month. Keeps historical payroll
 * accurate after a salary revision.
 */
export function structureForMonth<T extends { effective_from: string }>(
  structures: readonly T[],
  month: Date,
): T | null {
  // A revision applies to a month if it took effect on or before the END of
  // that month. Comparing against the START would ignore a revision dated
  // mid-month, leaving that month with no structure at all and blocking
  // payroll entirely.
  const monthEnd = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const eligible = structures
    .filter((s) => s.effective_from <= monthEnd)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return eligible[0] ?? null;
}

/**
 * Client-side twin of the RLS function public.employee_may_mark(date).
 * An employee may self-mark present/absent for a date that is not in the
 * future, within the current month, or within the previous month up to the
 * day before the configured payment date. Authoritative check is in Postgres.
 */
export function employeeMayMark(
  d: Date,
  paymentDay = 10,
  now: Date = new Date(),
): boolean {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day > today) return false;

  const curMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (day >= curMonth) return true;

  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  if (day >= prevMonth && day < curMonth) {
    return today.getDate() < paymentDay;
  }
  return false;
}
