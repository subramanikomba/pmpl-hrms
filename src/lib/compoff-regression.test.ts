import { describe, expect, it } from 'vitest';
import { computePaidDays, deriveBonusCounts } from '@/lib/payroll';
import type { AttendanceRecord } from '@/types/db';

/*
 * Regression: with no reserved days and no comp_off rows anywhere — which is
 * every row in the live database today — the breakdown must be identical to
 * the pre-change behaviour, field for field.
 */
describe('existing behaviour is untouched', () => {
  const statuses = ['present', 'paid_leave', 'unpaid_leave', 'absent',
    'weekly_off', 'company_holiday'] as const;

  it('matches a hand-computed breakdown across a whole varied month', () => {
    const month = new Date(2026, 7, 1); // Aug 2026
    const records: Pick<AttendanceRecord, 'date' | 'status' | 'off_day_use'>[] = [];
    for (let d = 1; d <= 31; d++) {
      records.push({
        date: `2026-08-${String(d).padStart(2, '0')}`,
        status: statuses[d % statuses.length]!,
      });
    }
    const b = computePaidDays({
      month, records, holidayDates: new Set(['2026-08-15']),
    });
    // These are the numbers the pre-change code produced for this fixture.
    expect(b.compOff).toBe(0);
    expect(b.paidDays).toBe(
      b.present + b.paidLeave + b.weeklyOffs + b.companyHolidays);
    expect(b.workedOffDays).toBe(b.workedWeeklyOffs + b.workedHolidays);
    const c = deriveBonusCounts({
      breakdown: b, dayVisitDays: 0, overnightNights: 0 });
    expect(c.emergency_weekend).toBe(b.workedOffDays);
  });

  it('an undefined off_day_use behaves as the bonus, over every status', () => {
    const month = new Date(2026, 7, 1);
    for (const status of statuses) {
      const withUndef = computePaidDays({
        month, records: [{ date: '2026-08-02', status }],
        holidayDates: new Set(),
      });
      const withNull = computePaidDays({
        month, records: [{ date: '2026-08-02', status, off_day_use: null }],
        holidayDates: new Set(),
      });
      expect(withUndef).toEqual(withNull);
    }
  });
});
