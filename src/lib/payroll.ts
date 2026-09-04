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
  /** Authorised unpaid leave. Excluded from paidDays, distinct from absent. */
  unpaidLeave: number;
  weeklyOffs: number;
  companyHolidays: number;
  absent: number;
  paidDays: number;
  /**
   * Days the employee marked Present that fall on a weekly off or a company
   * holiday. These are ALREADY paid as offs/holidays, so they are deliberately
   * excluded from `paidDays` — the count exists purely to supply the quantity
   * for the Emergency / Weekend Service allowance rule.
   */
  workedWeeklyOffs: number;
  workedHolidays: number;
  workedOffDays: number;
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
  /** Working days (0=Sun..6=Sat). Defaults to Mon–Sat. */
  workingDays?: readonly number[];
}): PaidDayBreakdown {
  const { month, records, holidayDates } = params;
  const working = new Set(params.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const total = daysInMonth(month);
  const byDate = new Map<string, AttendanceStatus>();
  for (const r of records) byDate.set(r.date, r.status);

  const upTo = params.upTo ? isoDate(params.upTo) : null;

  let present = 0, paidLeave = 0, weeklyOffs = 0, companyHolidays = 0, absent = 0;
  let unpaidLeave = 0;
  let workedWeeklyOffs = 0, workedHolidays = 0;

  for (let day = 1; day <= total; day++) {
    const d = new Date(month.getFullYear(), month.getMonth(), day);
    const ds = isoDate(d);
    if (upTo && ds > upTo) continue;

    const status = byDate.get(ds);

    // A non-working day stays a paid weekly off even when the employee
    // actually worked it — the day is already paid, so counting it as
    // Present too would pay it twice. The work is recognised through the
    // Emergency / Weekend allowance instead, via workedWeeklyOffs.
    if (!working.has(d.getDay())) {
      weeklyOffs++;
      if (status === 'present') workedWeeklyOffs++;
      continue;
    }
    // Same reasoning for a company holiday: paid once as a holiday, with the
    // work recognised through the allowance rule.
    if (holidayDates.has(ds)) {
      companyHolidays++;
      if (status === 'present') workedHolidays++;
      continue;
    }
    if (status === 'present') { present++; continue; }
    if (status === 'paid_leave') { paidLeave++; continue; }
    // Authorised but unpaid: not a paid day, and not the same as Absent.
    if (status === 'unpaid_leave') { unpaidLeave++; continue; }
    if (status === 'company_holiday') { companyHolidays++; continue; }
    if (status === 'weekly_off') { weeklyOffs++; continue; }
    absent++;
  }

  return {
    present, paidLeave, unpaidLeave, weeklyOffs, companyHolidays, absent,
    paidDays: present + paidLeave + weeklyOffs + companyHolidays,
    workedWeeklyOffs, workedHolidays,
    workedOffDays: workedWeeklyOffs + workedHolidays,
  };
}

/** One configured allowance rule, with the quantity the Admin entered. */
export interface AllowanceLine {
  rule_key: string;
  description: string;
  rate_percent: number;
  /**
   * The Count actually used for payroll — Admin's final figure. Days, nights,
   * projects, or 1/0 for a one-off such as the attendance bonus.
   */
  quantity: number;
  /**
   * What the system derived from the month's records. Retained so a manual
   * override stays visible afterwards; these Counts affect salary.
   */
  system_quantity?: number;
  override_reason?: string | null;
  amount: number;
}

/**
 * Spec §8: allowance rules are percentages (e.g. 2.5% per night). The rate
 * applies to Basic, multiplied by the quantity the Admin enters for that
 * month. The system does not infer quantities — there is no visit tracking,
 * so the Admin supplies them.
 */
export function computeAllowanceAmount(
  basic: number, ratePercent: number, quantity: number,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return round2(basic * (ratePercent / 100) * quantity);
}

export interface PayrollInput {
  structure: Pick<SalaryStructure,
    'basic' | 'hra' | 'special_allowance' | 'transport_allowance'
    | 'medical_allowance' | 'conveyance_other'>;
  paidDays: number;
  daysInMonth: number;
  performanceBonus: number;
  annualBonus: number;
  /** Total of the configured allowance rules for this month. */
  allowancesTotal?: number;
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
    input.performanceBonus + input.annualBonus +
    (input.allowancesTotal ?? 0),
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
 * Last day of the current month on which the PREVIOUS month's attendance may
 * still be modified. E.g. with a value of 5, August stays editable during
 * 1–5 September and is closed from 6 September. Deliberately independent of
 * the salary payment day, which governs payroll locking, not data entry.
 *
 * Must stay in step with public.employee_may_mark(date) in Postgres.
 */
export const ATTENDANCE_EDIT_CUTOFF_DAY = 5;

/**
 * Client-side twin of the RLS function public.employee_may_mark(date).
 * An employee may self-mark for a date that is not in the future and is
 * either in the current month, or in the previous month while today is on or
 * before ATTENDANCE_EDIT_CUTOFF_DAY. Authoritative check is in Postgres.
 */
export function employeeMayMark(
  d: Date,
  now: Date = new Date(),
): boolean {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day > today) return false;

  const curMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (day >= curMonth) return true;

  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  if (day >= prevMonth && day < curMonth) {
    return today.getDate() <= ATTENDANCE_EDIT_CUTOFF_DAY;
  }
  return false;
}

/**
 * Whether a past-dated change to Present needs Admin approval rather than
 * taking effect immediately. Today's own attendance is always direct; any
 * earlier date raises a request. Mirrors the attendance RLS write policies.
 */
export function needsPresentApproval(d: Date, now: Date = new Date()): boolean {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return day < today;
}

/* ── System-derived bonus counts ───────────────────────────────── */

export const RULE_ATTENDANCE_BONUS = 'attendance_bonus';
export const RULE_EMERGENCY_WEEKEND = 'emergency_weekend';
export const RULE_OUTDOOR_DAY = 'outdoor_day';
export const RULE_OUTDOOR_OVERNIGHT = 'outdoor_overnight';
export const RULE_SITE_COMPLETION = 'site_completion';

/**
 * Does the month qualify for the 100% Attendance Bonus?
 *
 * "Full attendance" means every working day in the month was actually worked:
 * no absent days and no leave taken. Weekly offs and company holidays are not
 * working days, so they never disqualify.
 */
export function qualifiesForAttendanceBonus(b: PaidDayBreakdown): boolean {
  return b.absent === 0 && b.paidLeave === 0 && b.unpaidLeave === 0
    && b.present > 0;
}

/**
 * The system's best count for each bonus rule, from the records that exist.
 *
 * These are STARTING POINTS only. Admin may edit any of them — deliberately,
 * because the system must not decide business questions such as whether a
 * Sunday spent on an outdoor visit is paid as weekend service or as an
 * outdoor visit. It surfaces both counts and lets Admin choose.
 */
export function deriveBonusCounts(args: {
  breakdown: PaidDayBreakdown;
  dayVisitDays: number;
  overnightVisits: number;
}): Record<string, number> {
  return {
    [RULE_ATTENDANCE_BONUS]: qualifiesForAttendanceBonus(args.breakdown) ? 1 : 0,
    [RULE_EMERGENCY_WEEKEND]: args.breakdown.workedOffDays,
    [RULE_OUTDOOR_DAY]: args.dayVisitDays,
    [RULE_OUTDOOR_OVERNIGHT]: args.overnightVisits,
    // No automated record exists for site completion; Admin enters it.
    [RULE_SITE_COMPLETION]: 0,
  };
}

/* ── Attendance Not Marked exceptions ──────────────────────────── */

/**
 * "Attendance Not Marked" is a distinct state, not a synonym for Absent.
 *
 * Daily-wage pay depends on the difference, so an unmarked day is never
 * silently converted: it is raised to Admin to resolve through the normal
 * attendance mechanism.
 */
export interface AttendanceException {
  employeeId: string;
  date: string;
}

/**
 * Working days up to and including `upTo` with no attendance record.
 *
 * Today only counts once the configured end-of-day cutoff has passed —
 * before that, an employee may still legitimately mark themselves present.
 * Weekly offs and company holidays are never exceptions.
 */
export function findUnmarkedAttendance(args: {
  employeeIds: readonly string[];
  records: readonly { employee_id: string; date: string }[];
  month: Date;
  holidayDates: ReadonlySet<string>;
  workingDays?: readonly number[];
  /** "HH:MM" end-of-day cutoff from settings. */
  cutoffTime: string;
  /**
   * Include today even before the cutoff. Used where Admin has explicitly
   * asked to see the current position rather than being alerted.
   */
  ignoreCutoff?: boolean;
  now: Date;
}): AttendanceException[] {
  const working = new Set(args.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const marked = new Set(args.records.map((r) => `${r.employee_id}|${r.date}`));
  const todayIso = isoDate(args.now);

  const [ch, cm] = args.cutoffTime.split(':');
  const cutoffPassed = args.ignoreCutoff === true
    || args.now.getHours() * 60 + args.now.getMinutes()
      >= Number(ch) * 60 + Number(cm ?? 0);

  const out: AttendanceException[] = [];
  const total = daysInMonth(args.month);
  for (let day = 1; day <= total; day++) {
    const d = new Date(args.month.getFullYear(), args.month.getMonth(), day);
    const ds = isoDate(d);
    if (ds > todayIso) break;
    // Today is only an exception after the cutoff.
    if (ds === todayIso && !cutoffPassed && !args.ignoreCutoff) continue;
    if (!working.has(d.getDay())) continue;
    if (args.holidayDates.has(ds)) continue;
    for (const id of args.employeeIds) {
      if (!marked.has(`${id}|${ds}`)) out.push({ employeeId: id, date: ds });
    }
  }
  return out;
}
