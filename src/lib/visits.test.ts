import { describe, expect, it } from 'vitest';
import { countVisitsForMonth, to12Hour, validateVisit, travelDaysNeedingVisit
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
    visitType: 'overnight', startDate: '2026-09-01', endDate: '2026-09-05',
    startTime: '10:00', endTime: '17:00', ...o,
  });

  it('Day 1 to Day 5 gives 5 days and 4 nights', () => {
    const r = validateVisit(overnight(), today);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.dayCount).toBe(5);
    expect(r.ok && r.value.nights).toBe(4);
  });

  it('accepts a daytime departure', () => {
    // The old evening-departure rule is gone.
    expect(validateVisit(overnight({ startTime: '10:00', endTime: '17:00' }), today).ok)
      .toBe(true);
  });

  it('no longer requires departure after 16:00 or return before noon', () => {
    expect(validateVisit(overnight({ startTime: '08:00', endTime: '23:00' }), today).ok)
      .toBe(true);
    expect(validateVisit(overnight({ startTime: '13:30', endTime: '14:45' }), today).ok)
      .toBe(true);
  });

  it('accepts a single night', () => {
    const r = validateVisit(
      overnight({ startDate: '2026-09-01', endDate: '2026-09-02' }), today);
    expect(r.ok && r.value.dayCount).toBe(2);
    expect(r.ok && r.value.nights).toBe(1);
  });

  it('rejects a same-day overnight visit', () => {
    expect(validateVisit(overnight({ endDate: '2026-09-01' }), today).ok).toBe(false);
  });

  it('accepts a cross-month overnight visit', () => {
    const r = validateVisit(overnight({
      startDate: '2026-08-29', endDate: '2026-09-02',
    }), today);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.dayCount).toBe(5);
    expect(r.ok && r.value.nights).toBe(4);
  });

  it('enforces the 60-day sanity cap', () => {
    expect(validateVisit(overnight({
      startDate: '2026-06-01', endDate: '2026-09-05',
    }), today).ok).toBe(false);
  });
});

describe('day visits', () => {
  it('a same-day visit is 1 day and 0 nights', () => {
    const r = validateVisit(draft({ endDate: '' }), today);
    expect(r.ok && r.value.dayCount).toBe(1);
    expect(r.ok && r.value.nights).toBe(0);
  });

  it('a multi-day day visit counts each day and no nights', () => {
    const r = validateVisit(draft({
      startDate: '2026-09-01', endDate: '2026-09-05',
      startTime: '09:00', endTime: '18:00',
    }), today);
    expect(r.ok && r.value.dayCount).toBe(5);
    expect(r.ok && r.value.nights).toBe(0);
  });

  it('accepts a cross-month day visit', () => {
    expect(validateVisit(draft({
      startDate: '2026-08-30', endDate: '2026-09-02',
    }), today).ok).toBe(true);
  });
});

describe('countVisitsForMonth', () => {
  const v = (o: Record<string, unknown>) => ({
    end_date: '2026-09-05', visit_type: 'day' as const,
    status: 'approved' as const, day_count: 1, nights: 0, ...o,
  }) as never;
  const sep = new Date(2026, 8, 1);
  const oct = new Date(2026, 9, 1);

  it('counts only approved visits', () => {
    const c = countVisitsForMonth([
      v({}), v({ status: 'pending' }), v({ status: 'rejected' }),
    ], sep);
    expect(c.visits).toBe(1);
    expect(c.dayVisitDays).toBe(1);
  });

  it('an overnight visit contributes NIGHTS, not 1', () => {
    const c = countVisitsForMonth([
      v({ visit_type: 'overnight', day_count: 5, nights: 4 }),
    ], sep);
    expect(c.overnightNights).toBe(4);
  });

  it('keeps the two categories mutually exclusive', () => {
    // A 5-day / 4-night trip must not also add 5 outdoor day visits.
    const c = countVisitsForMonth([
      v({ visit_type: 'overnight', day_count: 5, nights: 4 }),
    ], sep);
    expect(c.dayVisitDays).toBe(0);

    const d = countVisitsForMonth([
      v({ visit_type: 'day', day_count: 3, nights: 0 }),
    ], sep);
    expect(d.overnightNights).toBe(0);
    expect(d.dayVisitDays).toBe(3);
  });

  it('allocates a cross-month visit to the month it RETURNED in', () => {
    // 29 Sep -> 2 Oct: 4 days, 3 nights. October gets all of it.
    const visit = v({
      end_date: '2026-10-02', visit_type: 'overnight', day_count: 4, nights: 3,
    });
    expect(countVisitsForMonth([visit], sep).overnightNights).toBe(0);
    expect(countVisitsForMonth([visit], sep).visits).toBe(0);
    expect(countVisitsForMonth([visit], oct).overnightNights).toBe(3);
    expect(countVisitsForMonth([visit], oct).visits).toBe(1);
  });

  it('allocates a 30 Sep -> 1 Oct visit to October', () => {
    const visit = v({
      end_date: '2026-10-01', visit_type: 'overnight', day_count: 2, nights: 1,
    });
    expect(countVisitsForMonth([visit], sep).overnightNights).toBe(0);
    expect(countVisitsForMonth([visit], oct).overnightNights).toBe(1);
  });

  it('still aggregates a same-month visit correctly', () => {
    const c = countVisitsForMonth([
      v({ end_date: '2026-09-12', visit_type: 'overnight', day_count: 3, nights: 2 }),
    ], sep);
    expect(c.overnightNights).toBe(2);
    expect(c.visits).toBe(1);
  });
});

describe('travelDaysNeedingVisit', () => {
  // 12 Oct 2026. The visit window is this month, plus last month until
  // ATTENDANCE_EDIT_CUTOFF_DAY (the 5th) — NOT the 10th, which is the
  // separate leave back-dating cutoff. So September is already closed.
  const today = new Date(2026, 9, 12);
  const exp = (date: string, category = 'Travel', status = 'approved') =>
    ({ expense_date: date, category, status });
  const visit = (start: string, end = start, status = 'approved') =>
    ({ start_date: start, end_date: end, status });

  it('flags a travel claim with no visit', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-10-03')], visits: [], today,
    })).toEqual(['2026-10-03']);
  });

  it('says nothing once a visit covers the day', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-10-03')],
      visits: [visit('2026-10-01', '2026-10-05')], today,
    })).toEqual([]);
  });

  it('counts a PENDING visit as recorded, so the nudge clears at once', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-10-03')],
      visits: [visit('2026-10-03', '2026-10-03', 'pending')], today,
    })).toEqual([]);
  });

  it('ignores a rejected visit', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-10-03')],
      visits: [visit('2026-10-03', '2026-10-03', 'rejected')], today,
    })).toEqual(['2026-10-03']);
  });

  it('ignores categories that are not Travel', () => {
    expect(travelDaysNeedingVisit({
      expenses: [
        exp('2026-10-03', 'Local Conveyance'),
        exp('2026-10-04', 'Food'),
        exp('2026-10-05', 'Parts/Components'),
      ],
      visits: [], today,
    })).toEqual([]);
  });

  it('ignores a rejected claim', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-10-03', 'Travel', 'rejected')], visits: [], today,
    })).toEqual([]);
  });

  it('counts a pending claim, which is still evidence of a trip', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-10-03', 'Travel', 'pending')], visits: [], today,
    })).toEqual(['2026-10-03']);
  });

  it('stays silent about days too old to record a visit for', () => {
    // 12 Oct is past the 5th, so September is closed to new visits.
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-09-24')], visits: [], today,
    })).toEqual([]);
  });

  it('does include last month while the window is still open', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-09-24')], visits: [], today: new Date(2026, 9, 4),
    })).toEqual(['2026-09-24']);
  });

  it('closes last month on the 5th, not the 10th', () => {
    // Worth pinning down: the visit window is SHORTER than the leave window,
    // so by payroll day last month can no longer be filed for.
    const open = travelDaysNeedingVisit({
      expenses: [exp('2026-09-24')], visits: [], today: new Date(2026, 9, 5),
    });
    const shut = travelDaysNeedingVisit({
      expenses: [exp('2026-09-24')], visits: [], today: new Date(2026, 9, 6),
    });
    expect(open).toEqual(['2026-09-24']);
    expect(shut).toEqual([]);
  });

  it('reports each day once and in order', () => {
    expect(travelDaysNeedingVisit({
      expenses: [exp('2026-10-09'), exp('2026-10-03'), exp('2026-10-09')],
      visits: [], today,
    })).toEqual(['2026-10-03', '2026-10-09']);
  });
});
