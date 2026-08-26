import { describe, expect, it } from 'vitest';
import {
  computePaidDays, computePayroll, daysInMonth, isPayrollMonthLocked,
  isoDate, professionalTaxFor, round2, structureForMonth, employeeMayMark,
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
    expect(employeeMayMark(new Date(2026, 7, 15), 10, now)).toBe(true);
  });
  it('allows past dates in the current month', () => {
    expect(employeeMayMark(new Date(2026, 7, 1), 10, now)).toBe(true);
    expect(employeeMayMark(new Date(2026, 7, 14), 10, now)).toBe(true);
  });
  it('blocks future dates', () => {
    expect(employeeMayMark(new Date(2026, 7, 16), 10, now)).toBe(false);
    expect(employeeMayMark(new Date(2026, 8, 1), 10, now)).toBe(false);
  });
  it('blocks the previous month once the payment day has arrived', () => {
    // 15th >= payment day 10 -> July is closed
    expect(employeeMayMark(new Date(2026, 6, 20), 10, now)).toBe(false);
  });
  it('allows the previous month before the payment day', () => {
    const early = new Date(2026, 7, 5); // 5th < payment day 10
    expect(employeeMayMark(new Date(2026, 6, 20), 10, early)).toBe(true);
  });
  it('blocks months older than the previous month', () => {
    const early = new Date(2026, 7, 5);
    expect(employeeMayMark(new Date(2026, 5, 20), 10, early)).toBe(false);
  });
});
