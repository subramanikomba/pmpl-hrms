import { describe, expect, it } from 'vitest';
import {
  countVisitsForMonth, isOvernightPattern, to12Hour, validateVisit,
} from './visits';

const today = new Date(2026, 8, 20); // 20 Sep 2026

const draft = (o: Partial<Parameters<typeof validateVisit>[0]> = {}) => ({
  startDate: '2026-09-10', endDate: '', startTime: '09:00', endTime: '18:00',
  visitType: 'day' as const, location: 'Site A', ...o,
});

describe('to12Hour', () => {
  it('renders AM/PM, never a 24-hour clock', () => {
    expect(to12Hour('09:00')).toBe('9:00 AM');
    expect(to12Hour('18:30')).toBe('6:30 PM');
    expect(to12Hour('00:00')).toBe('12:00 AM');
    expect(to12Hour('12:00')).toBe('12:00 PM');
  });
});

describe('required fields', () => {
  it('requires a start date', () => {
    expect(validateVisit(draft({ startDate: '' }), today)).toMatchObject({ ok: false });
  });
  it('requires both times', () => {
    expect(validateVisit(draft({ startTime: '' }), today)).toMatchObject({ ok: false });
    expect(validateVisit(draft({ endTime: '' }), today)).toMatchObject({ ok: false });
  });
  it('requires a location', () => {
    expect(validateVisit(draft({ location: '   ' }), today)).toMatchObject({ ok: false });
  });
});

describe('dates', () => {
  it('defaults a blank end date to the start date', () => {
    const r = validateVisit(draft({ endDate: '' }), today);
    expect(r.ok && r.value.endDate).toBe('2026-09-10');
    expect(r.ok && r.value.dayCount).toBe(1);
  });
  it('rejects a future start or end date', () => {
    expect(validateVisit(draft({ startDate: '2026-09-21' }), today))
      .toMatchObject({ ok: false });
    expect(validateVisit(draft({ endDate: '2026-09-25' }), today))
      .toMatchObject({ ok: false });
  });
  it('rejects an end date before the start date', () => {
    expect(validateVisit(draft({ startDate: '2026-09-10', endDate: '2026-09-09' }), today))
      .toMatchObject({ ok: false });
  });
  it('rejects a visit spanning two calendar months', () => {
    // Payroll-period safety: a visit must belong to exactly one month.
    const r = validateVisit(draft({
      startDate: '2026-08-31', endDate: '2026-09-01',
      startTime: '09:00', endTime: '18:00',
    }), today);
    expect(r.ok).toBe(false);
  });
});

describe('same-day visits', () => {
  it('accepts 9:00 AM to 6:00 PM', () => {
    expect(validateVisit(draft({ startTime: '09:00', endTime: '18:00' }), today).ok)
      .toBe(true);
  });
  it('rejects equal start and end times', () => {
    expect(validateVisit(draft({ startTime: '09:00', endTime: '09:00' }), today).ok)
      .toBe(false);
  });
  it('rejects an end time before the start time', () => {
    expect(validateVisit(draft({ startTime: '18:00', endTime: '09:00' }), today).ok)
      .toBe(false);
  });
});

describe('overnight visits', () => {
  const overnight = (o = {}) => draft({
    visitType: 'overnight', startDate: '2026-09-10', endDate: '2026-09-11',
    startTime: '21:00', endTime: '07:00', ...o,
  });

  it('accepts 10 Sep 9:00 PM to 11 Sep 7:00 AM and counts 1', () => {
    const r = validateVisit(overnight(), today);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.nights).toBe(1);
    expect(r.ok && r.value.dayCount).toBe(0);
  });

  it('rejects a two-night span rather than classifying it as one', () => {
    // 10 Sep 9:00 PM -> 12 Sep 7:00 AM must not become a single overnight.
    expect(validateVisit(overnight({ endDate: '2026-09-12' }), today).ok).toBe(false);
  });

  it('rejects consecutive dates that are not an overnight pattern', () => {
    // Differing dates alone must never imply overnight.
    expect(validateVisit(overnight({ startTime: '09:00', endTime: '17:00' }), today).ok)
      .toBe(false);
  });

  it('rejects a same-day overnight', () => {
    expect(validateVisit(overnight({ endDate: '2026-09-10' }), today).ok).toBe(false);
  });
});

describe('day visits must not be overnight in disguise', () => {
  it('rejects an evening-to-next-morning span typed as a day visit', () => {
    const r = validateVisit(draft({
      visitType: 'day', startDate: '2026-09-10', endDate: '2026-09-11',
      startTime: '21:00', endTime: '07:00',
    }), today);
    expect(r.ok).toBe(false);
  });

  it('accepts a genuine multi-day daytime visit and counts each day', () => {
    const r = validateVisit(draft({
      startDate: '2026-09-10', endDate: '2026-09-12',
      startTime: '09:00', endTime: '18:00',
    }), today);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.dayCount).toBe(3);
    expect(r.ok && r.value.nights).toBe(0);
  });
});

describe('isOvernightPattern', () => {
  it('needs consecutive dates AND the evening/morning times', () => {
    expect(isOvernightPattern('2026-09-10', '21:00', '2026-09-11', '07:00')).toBe(true);
    expect(isOvernightPattern('2026-09-10', '09:00', '2026-09-11', '07:00')).toBe(false);
    expect(isOvernightPattern('2026-09-10', '21:00', '2026-09-11', '18:00')).toBe(false);
    expect(isOvernightPattern('2026-09-10', '21:00', '2026-09-12', '07:00')).toBe(false);
  });
});

describe('countVisitsForMonth', () => {
  const v = (o: Record<string, unknown>) => ({
    start_date: '2026-09-05', visit_type: 'day' as const,
    status: 'approved' as const, day_count: 1, nights: 0, ...o,
  }) as never;
  const sep = new Date(2026, 8, 1);

  it('counts only approved visits', () => {
    const c = countVisitsForMonth([
      v({}), v({ status: 'pending' }), v({ status: 'rejected' }),
    ], sep);
    expect(c.visits).toBe(1);
    expect(c.dayVisitDays).toBe(1);
  });

  it('splits the two categories and never counts both', () => {
    const c = countVisitsForMonth([
      v({ day_count: 3 }),
      v({ visit_type: 'overnight', day_count: 0, nights: 1 }),
    ], sep);
    expect(c.dayVisitDays).toBe(3);
    expect(c.overnightVisits).toBe(1);
  });

  it('ignores visits from another payroll month', () => {
    const c = countVisitsForMonth([v({ start_date: '2026-08-28' })], sep);
    expect(c.visits).toBe(0);
  });
});
