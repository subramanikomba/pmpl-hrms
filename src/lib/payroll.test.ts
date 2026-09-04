import { describe, expect, it } from 'vitest';
import {
  computeAllowanceAmount, computePaidDays, computePayroll, daysInMonth, isPayrollMonthLocked,
  isoDate, professionalTaxFor, round2, structureForMonth, employeeMayMark,
  needsPresentApproval, deriveBonusCounts, qualifiesForAttendanceBonus,
  findUnmarkedAttendance,
} from './payroll';

const STRUCT = {
  basic: 20000, hra: 8000, special_allowance: 4000,
  transport_allowance: 2000, medical_allowance: 1000, conveyance_other: 1000,
}; // full-month gross = 36,000

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.344)).toBe(2.34);
    expect(round2(10)).toBe(10);
  });
});

describe('isoDate', () => {
  it('uses local time, not UTC (no off-by-one near midnight)', () => {
    expect(isoDate(new Date(2026, 7, 1))).toBe('2026-08-01');
    expect(isoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('daysInMonth', () => {
  it('handles month lengths including leap February', () => {
    expect(daysInMonth(new Date(2026, 1, 1))).toBe(28);
    expect(daysInMonth(new Date(2028, 1, 1))).toBe(29); // leap year
    expect(daysInMonth(new Date(2026, 7, 1))).toBe(31);
  });
});

describe('professionalTaxFor', () => {
  const s = { pt_monthly: 200, pt_february: 300 };
  it('charges 300 in February and 200 otherwise', () => {
    expect(professionalTaxFor(new Date(2026, 1, 1), s)).toBe(300);
    expect(professionalTaxFor(new Date(2026, 7, 1), s)).toBe(200);
  });
});

describe('computePaidDays', () => {
  const month = new Date(2026, 7, 1); // Aug 2026: 31 days, 5 Sundays

  it('counts Sundays as paid weekly offs', () => {
    const b = computePaidDays({ month, records: [], holidayDates: new Set() });
    expect(b.weeklyOffs).toBe(5);
  });

  it('counts present, paid leave and holidays as paid days', () => {
    const b = computePaidDays({
      month,
      records: [
        { date: '2026-08-03', status: 'present' },
        { date: '2026-08-04', status: 'present' },
        { date: '2026-08-05', status: 'paid_leave' },
      ],
      holidayDates: new Set(['2026-08-15']),
    });
    expect(b.present).toBe(2);
    expect(b.paidLeave).toBe(1);
    expect(b.companyHolidays).toBe(1);
    expect(b.paidDays).toBe(2 + 1 + 1 + b.weeklyOffs);
  });

  it('treats unmarked past working days as absent', () => {
    const b = computePaidDays({
      month, records: [], holidayDates: new Set(),
      upTo: new Date(2026, 7, 5),
    });
    // Aug 1 (Sat), 3, 4, 5 are working days; Aug 2 is a Sunday.
    expect(b.absent).toBe(4);
    expect(b.weeklyOffs).toBe(1);
  });

  it('does not count future days as absent', () => {
    const b = computePaidDays({
      month, records: [], holidayDates: new Set(),
      upTo: new Date(2026, 7, 1),
    });
    expect(b.absent).toBe(1);
  });

  it('honours a configured working-day calendar', () => {
    // Mon–Fri working: Saturdays become paid weekly offs too.
    const b = computePaidDays({
      month, records: [], holidayDates: new Set(),
      workingDays: [1, 2, 3, 4, 5],
    });
    // Aug 2026 has 5 Sundays and 5 Saturdays
    expect(b.weeklyOffs).toBe(10);
  });

  it('defaults to Mon–Sat when no calendar is given', () => {
    const b = computePaidDays({ month, records: [], holidayDates: new Set() });
    expect(b.weeklyOffs).toBe(5); // Sundays only
  });

  it('counts a Sunday worked without paying the day twice', () => {
    const worked = computePaidDays({
      month,
      records: [{ date: '2026-08-02', status: 'present' }], // a Sunday
      holidayDates: new Set(),
    });
    const idle = computePaidDays({ month, records: [], holidayDates: new Set() });
    expect(worked.workedWeeklyOffs).toBe(1);
    expect(worked.workedOffDays).toBe(1);
    expect(worked.weeklyOffs).toBe(idle.weeklyOffs);
    expect(worked.paidDays).toBe(idle.paidDays);
  });

  it('counts a company holiday worked without paying the day twice', () => {
    const worked = computePaidDays({
      month,
      records: [{ date: '2026-08-15', status: 'present' }],
      holidayDates: new Set(['2026-08-15']),
    });
    const idle = computePaidDays({
      month, records: [], holidayDates: new Set(['2026-08-15']),
    });
    expect(worked.workedHolidays).toBe(1);
    expect(worked.companyHolidays).toBe(idle.companyHolidays);
    expect(worked.paidDays).toBe(idle.paidDays);
  });

  it('never counts a Sunday as absent even without a record', () => {
    const b = computePaidDays({ month, records: [], holidayDates: new Set() });
    expect(b.weeklyOffs + b.absent).toBe(31);
    expect(b.weeklyOffs).toBe(5);
  });
});

describe('computePayroll', () => {
  it('pays full salary for a full month', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 31, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0, professionalTax: 200,
      salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    expect(r.gross_salary).toBe(36000);
    expect(r.net_salary).toBe(35800);
  });

  it('prorates fixed components on paid days', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 15, daysInMonth: 30,
      performanceBonus: 0, annualBonus: 0, professionalTax: 200,
      salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    expect(r.basic).toBe(10000);
    expect(r.gross_salary).toBe(18000);
  });

  it('does NOT prorate bonuses', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 15, daysInMonth: 30,
      performanceBonus: 5000, annualBonus: 2000, professionalTax: 200,
      salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    // 18,000 prorated + 7,000 bonus (unprorated)
    expect(r.gross_salary).toBe(25000);
  });

  it('subtracts all deductions from gross', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 31, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0, professionalTax: 200,
      salaryAdvanceRecovered: 5000, otherDeductions: 500,
    });
    expect(r.total_deductions).toBe(5700);
    expect(r.net_salary).toBe(30300);
  });

  it('never pays more than a full month even if paid days exceed the month', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 40, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0, professionalTax: 0,
      salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    expect(r.gross_salary).toBe(36000);
  });

  it('pays zero for zero paid days', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 0, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0, professionalTax: 200,
      salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    expect(r.gross_salary).toBe(0);
    expect(r.net_salary).toBe(-200);
  });
});

describe('isPayrollMonthLocked', () => {
  it('is unlocked before the payment date passes', () => {
    expect(isPayrollMonthLocked(
      new Date(2026, 7, 1), 10, new Date(2026, 8, 9),
    )).toBe(false);
  });

  it('is still unlocked on the payment day itself', () => {
    expect(isPayrollMonthLocked(
      new Date(2026, 7, 1), 10, new Date(2026, 8, 10, 12),
    )).toBe(false);
  });

  it('locks once the payment date has passed', () => {
    expect(isPayrollMonthLocked(
      new Date(2026, 7, 1), 10, new Date(2026, 8, 11),
    )).toBe(true);
  });
});

describe('structureForMonth', () => {
  const structures = [
    { effective_from: '2026-01-01', basic: 10000 },
    { effective_from: '2026-06-01', basic: 20000 },
    { effective_from: '2027-01-01', basic: 30000 },
  ];

  it('picks the revision in force for the month', () => {
    expect(structureForMonth(structures, new Date(2026, 7, 1))?.basic).toBe(20000);
  });

  it('keeps historical months on their original structure', () => {
    expect(structureForMonth(structures, new Date(2026, 2, 1))?.basic).toBe(10000);
  });

  it('ignores revisions effective in the future', () => {
    expect(structureForMonth(structures, new Date(2026, 11, 1))?.basic).toBe(20000);
  });

  it('returns null when no revision applies yet', () => {
    expect(structureForMonth(structures, new Date(2025, 0, 1))).toBeNull();
  });

  // Regression: a revision dated mid-month must apply to that same month.
  // Comparing against the month START silently excluded it, so payroll for
  // that month found no structure and could not be processed.
  it('applies a revision dated mid-month to that same month', () => {
    const mid = [{ effective_from: '2026-08-25', basic: 5000 }];
    expect(structureForMonth(mid, new Date(2026, 7, 1))?.basic).toBe(5000);
  });

  it('applies a revision dated on the last day of the month', () => {
    const last = [{ effective_from: '2026-08-31', basic: 7000 }];
    expect(structureForMonth(last, new Date(2026, 7, 1))?.basic).toBe(7000);
  });

  it('still excludes a revision that starts after the month ends', () => {
    const next = [{ effective_from: '2026-09-01', basic: 9000 }];
    expect(structureForMonth(next, new Date(2026, 7, 1))).toBeNull();
  });

  it('prefers the latest revision when several apply within a month', () => {
    const many = [
      { effective_from: '2026-08-01', basic: 100 },
      { effective_from: '2026-08-20', basic: 200 },
    ];
    expect(structureForMonth(many, new Date(2026, 7, 1))?.basic).toBe(200);
  });
});

describe('employeeMayMark', () => {
  // "today" fixed at 15 Aug 2026 for deterministic assertions
  const now = new Date(2026, 7, 15);

  it('allows today', () => {
    expect(employeeMayMark(new Date(2026, 7, 15), now)).toBe(true);
  });
  it('allows past dates in the current month', () => {
    expect(employeeMayMark(new Date(2026, 7, 1), now)).toBe(true);
    expect(employeeMayMark(new Date(2026, 7, 14), now)).toBe(true);
  });
  it('blocks future dates', () => {
    expect(employeeMayMark(new Date(2026, 7, 16), now)).toBe(false);
    expect(employeeMayMark(new Date(2026, 8, 1), now)).toBe(false);
  });
  it('blocks the previous month after the 5th', () => {
    expect(employeeMayMark(new Date(2026, 6, 20), now)).toBe(false);
    // The 6th is the first day the previous month is closed.
    expect(employeeMayMark(new Date(2026, 6, 20), new Date(2026, 7, 6))).toBe(false);
  });
  it('allows the previous month up to and including the 5th', () => {
    expect(employeeMayMark(new Date(2026, 6, 20), new Date(2026, 7, 1))).toBe(true);
    expect(employeeMayMark(new Date(2026, 6, 20), new Date(2026, 7, 5))).toBe(true);
  });
  it('rolls over the year boundary without special-casing', () => {
    // 3 Jan 2027 -> December 2026 still open; 6 Jan -> closed.
    expect(employeeMayMark(new Date(2026, 11, 20), new Date(2027, 0, 3))).toBe(true);
    expect(employeeMayMark(new Date(2026, 11, 20), new Date(2027, 0, 6))).toBe(false);
  });
  it('blocks months older than the previous month', () => {
    const early = new Date(2026, 7, 5);
    expect(employeeMayMark(new Date(2026, 5, 20), early)).toBe(false);
  });
});

describe('needsPresentApproval', () => {
  const now = new Date(2026, 7, 15);
  it('marks today directly', () => {
    expect(needsPresentApproval(new Date(2026, 7, 15), now)).toBe(false);
  });
  it('requires approval for any earlier date', () => {
    expect(needsPresentApproval(new Date(2026, 7, 14), now)).toBe(true);
    expect(needsPresentApproval(new Date(2026, 6, 30), now)).toBe(true);
  });
});

describe('computeAllowanceAmount', () => {
  // Spec §8: 2.5% per night, 1.5% per day, 1% attendance bonus, etc.
  it('applies the rate to Basic per unit of quantity', () => {
    expect(computeAllowanceAmount(20000, 2.5, 2)).toBe(1000);   // 2 nights
    expect(computeAllowanceAmount(20000, 1.5, 3)).toBe(900);    // 3 day visits
    expect(computeAllowanceAmount(20000, 1, 1)).toBe(200);      // attendance bonus
  });
  it('is zero when the quantity is zero or invalid', () => {
    expect(computeAllowanceAmount(20000, 2.5, 0)).toBe(0);
    expect(computeAllowanceAmount(20000, 2.5, -1)).toBe(0);
    expect(computeAllowanceAmount(20000, 2.5, Number.NaN)).toBe(0);
  });
  it('rounds to two decimals', () => {
    expect(computeAllowanceAmount(5000, 1.5, 1)).toBe(75);
    expect(computeAllowanceAmount(3333, 2.5, 1)).toBe(83.33);
  });
});

describe('computePayroll with configured allowances', () => {
  it('adds the allowance total to gross', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 31, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0, allowancesTotal: 1500,
      professionalTax: 200, salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    expect(r.gross_salary).toBe(37500);   // 36,000 + 1,500
    expect(r.net_salary).toBe(37300);
  });
  it('does NOT prorate allowances (they are per-event, not monthly)', () => {
    const full = computePayroll({
      structure: STRUCT, paidDays: 31, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0, allowancesTotal: 1000,
      professionalTax: 0, salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    const half = computePayroll({
      structure: STRUCT, paidDays: 15.5, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0, allowancesTotal: 1000,
      professionalTax: 0, salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    // fixed components halve; the allowance does not
    expect(full.gross_salary - half.gross_salary).toBe(18000);
  });
  it('behaves as before when no allowances are entered', () => {
    const r = computePayroll({
      structure: STRUCT, paidDays: 31, daysInMonth: 31,
      performanceBonus: 0, annualBonus: 0,
      professionalTax: 200, salaryAdvanceRecovered: 0, otherDeductions: 0,
    });
    expect(r.gross_salary).toBe(36000);
  });
});

describe('computeAllowanceAmount', () => {
  it('is rate% of basic, multiplied by the quantity', () => {
    // 2 overnight visits at 2.5% of a 31,000 basic
    expect(computeAllowanceAmount(31000, 2.5, 2)).toBe(1550);
  });
  it('returns zero for a zero or missing quantity', () => {
    expect(computeAllowanceAmount(31000, 2.5, 0)).toBe(0);
    expect(computeAllowanceAmount(31000, 2.5, Number.NaN)).toBe(0);
  });
  it('never returns a negative amount', () => {
    expect(computeAllowanceAmount(31000, 2.5, -3)).toBe(0);
  });
  it('scales with the prorated basic, not the full salary', () => {
    // half a month worked -> half the allowance base
    expect(computeAllowanceAmount(15500, 2.5, 2)).toBe(775);
  });
});

describe('qualifiesForAttendanceBonus', () => {
  const base = {
    present: 26, paidLeave: 0, unpaidLeave: 0, weeklyOffs: 5,
    companyHolidays: 0, absent: 0, paidDays: 31, workedWeeklyOffs: 0,
    workedHolidays: 0, workedOffDays: 0,
  };
  it('qualifies with no absence and no leave', () => {
    expect(qualifiesForAttendanceBonus(base)).toBe(true);
  });
  it('does not qualify with an absent day', () => {
    expect(qualifiesForAttendanceBonus({ ...base, absent: 1 })).toBe(false);
  });
  it('does not qualify when leave was taken', () => {
    expect(qualifiesForAttendanceBonus({ ...base, paidLeave: 2 })).toBe(false);
    expect(qualifiesForAttendanceBonus({ ...base, unpaidLeave: 1 })).toBe(false);
  });
});

describe('deriveBonusCounts', () => {
  const breakdown = {
    present: 26, paidLeave: 0, unpaidLeave: 0, weeklyOffs: 5,
    companyHolidays: 0, absent: 0, paidDays: 31, workedWeeklyOffs: 2,
    workedHolidays: 0, workedOffDays: 2,
  };

  it('derives every rule from the records', () => {
    const c = deriveBonusCounts({
      breakdown, dayVisitDays: 3, overnightVisits: 1 });
    expect(c.attendance_bonus).toBe(1);
    expect(c.emergency_weekend).toBe(2);
    expect(c.outdoor_day).toBe(3);
    expect(c.outdoor_overnight).toBe(1);
    // No automated record exists for site completion.
    expect(c.site_completion).toBe(0);
  });

  it('surfaces both weekend and outdoor counts rather than choosing', () => {
    // A Sunday worked during an outdoor visit appears in BOTH counts. The
    // system must not silently drop one — Admin decides.
    const c = deriveBonusCounts({
      breakdown: { ...breakdown, workedOffDays: 1 },
      dayVisitDays: 1, overnightVisits: 0,
    });
    expect(c.emergency_weekend).toBe(1);
    expect(c.outdoor_day).toBe(1);
  });

  it('gives zero attendance bonus when the month was not full', () => {
    const c = deriveBonusCounts({
      breakdown: { ...breakdown, absent: 2 },
      dayVisitDays: 0, overnightVisits: 0,
    });
    expect(c.attendance_bonus).toBe(0);
  });
});

describe('findUnmarkedAttendance', () => {
  const month = new Date(2026, 8, 1); // September 2026
  const args = {
    employeeIds: ['e1'],
    month,
    holidayDates: new Set<string>(),
    workingDays: [1, 2, 3, 4, 5, 6],
    cutoffTime: '19:00',
  };

  it('reports working days with no record', () => {
    // 1-3 Sep 2026 are Tue-Thu; now is 3 Sep after cutoff.
    const out = findUnmarkedAttendance({
      ...args, records: [{ employee_id: 'e1', date: '2026-09-01' }],
      now: new Date(2026, 8, 3, 20, 0),
    });
    expect(out.map((x) => x.date)).toEqual(['2026-09-02', '2026-09-03']);
  });

  it('excludes today before the cutoff', () => {
    const out = findUnmarkedAttendance({
      ...args, records: [], now: new Date(2026, 8, 1, 10, 0),
    });
    expect(out).toEqual([]);
  });

  it('includes today once the cutoff has passed', () => {
    const out = findUnmarkedAttendance({
      ...args, records: [], now: new Date(2026, 8, 1, 19, 30),
    });
    expect(out).toEqual([{ employeeId: 'e1', date: '2026-09-01' }]);
  });

  it('never reports Sundays or company holidays', () => {
    const out = findUnmarkedAttendance({
      ...args,
      holidayDates: new Set(['2026-09-02']),
      records: [],
      now: new Date(2026, 8, 7, 20, 0),
    });
    // 6 Sep is a Sunday; 2 Sep is a holiday. Neither may appear.
    expect(out.some((x) => x.date === '2026-09-06')).toBe(false);
    expect(out.some((x) => x.date === '2026-09-02')).toBe(false);
  });
});
