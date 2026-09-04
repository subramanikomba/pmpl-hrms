/**
 * Outdoor visit rules.
 *
 * The business recognises exactly TWO categories and no third:
 *   - Day visit:       out and back during daytime. May span several calendar
 *                      days, each covered day counting once.
 *   - Overnight visit: leave in the evening/night, return the next morning.
 *                      Exactly one night, counting once.
 *
 * There is deliberately no combined "day + night" category, and an approved
 * visit contributes to one count only — never both.
 *
 * Everything here is pure so the same rules can run in the form, in the
 * approval dialog and in the payroll count derivation.
 */

export type VisitType = 'day' | 'overnight';
export type VisitStatus = 'pending' | 'approved' | 'rejected';

/**
 * A visit starting at or after this hour is treated as an evening/night
 * departure; one ending at or before MORNING_END_HOUR is a morning return.
 * These bound the overnight pattern so differing dates alone never imply it.
 */
export const EVENING_START_HOUR = 16; // 4:00 PM
export const MORNING_END_HOUR = 12;   // 12:00 noon

export interface VisitDraft {
  startDate: string;
  /** Blank means a single-day visit: End Date = Start Date. */
  endDate: string;
  startTime: string;
  endTime: string;
  visitType: VisitType;
  location: string;
}

export interface VisitResolved {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  visitType: VisitType;
  /** Days covered by a day visit; 0 for an overnight visit. */
  dayCount: number;
  /** Nights for an overnight visit (always 1); 0 for a day visit. */
  nights: number;
}

export type VisitValidation =
  | { ok: true; value: VisitResolved }
  | { ok: false; error: string };

/** Minutes since midnight for an "HH:MM" (or "HH:MM:SS") value. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

/** Whole calendar days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000);
}

/** "14:05" -> "2:05 PM". Employees never see a 24-hour clock. */
export function to12Hour(time: string | null): string {
  if (!time) return '—';
  const mins = minutesOf(time);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Does this date/time pair form the overnight pattern? Evening departure,
 * next-day morning return. Both halves must hold — differing dates alone is
 * never enough (rule 7).
 */
export function isOvernightPattern(
  startDate: string, startTime: string, endDate: string, endTime: string,
): boolean {
  if (daysBetween(startDate, endDate) !== 1) return false;
  return minutesOf(startTime) >= EVENING_START_HOUR * 60
    && minutesOf(endTime) <= MORNING_END_HOUR * 60;
}

/**
 * Validate a draft and resolve its derived counts.
 *
 * `today` is injected so the rules are testable and so "not in the future"
 * means the employee's today, not the server's.
 */
export function validateVisit(
  draft: VisitDraft, today: Date = new Date(),
): VisitValidation {
  const { startDate, startTime, endTime, visitType } = draft;
  const todayIso = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  if (!startDate) return { ok: false, error: 'Start date is required.' };
  if (startDate > todayIso) {
    return { ok: false, error: 'Start date cannot be in the future.' };
  }
  if (!startTime) return { ok: false, error: 'Start time is required.' };
  if (!endTime) return { ok: false, error: 'End time is required.' };
  if (!draft.location.trim()) {
    return { ok: false, error: 'Location is required.' };
  }

  // Blank end date means a single-day visit.
  const endDate = draft.endDate || startDate;
  if (endDate < startDate) {
    return { ok: false, error: 'End date cannot be before the start date.' };
  }
  if (endDate > todayIso) {
    return { ok: false, error: 'End date cannot be in the future.' };
  }
  if (startDate.slice(0, 7) !== endDate.slice(0, 7)) {
    return {
      ok: false,
      error: 'A visit must start and end in the same calendar month, so that '
        + 'it belongs to exactly one payroll period. Record it as two visits.',
    };
  }

  const span = daysBetween(startDate, endDate);
  const overnightPattern = isOvernightPattern(startDate, startTime, endDate, endTime);

  if (visitType === 'overnight') {
    if (span !== 1) {
      return {
        ok: false,
        error: 'An overnight visit must end on the day after it starts. '
          + 'Record a longer trip as separate visits.',
      };
    }
    if (!overnightPattern) {
      return {
        ok: false,
        error: `An overnight visit must leave in the evening (from `
          + `${to12Hour(`${EVENING_START_HOUR}:00`)}) and return the next `
          + `morning (by ${to12Hour(`${MORNING_END_HOUR}:00`)}).`,
      };
    }
    return {
      ok: true,
      value: {
        startDate, endDate, startTime, endTime,
        visitType: 'overnight', dayCount: 0, nights: 1,
      },
    };
  }

  // Day visit.
  if (span === 0 && minutesOf(endTime) <= minutesOf(startTime)) {
    return {
      ok: false,
      error: 'For a same-day visit the end time must be later than the start time.',
    };
  }
  if (overnightPattern) {
    return {
      ok: false,
      error: 'These times look like an overnight visit. Select Outdoor '
        + 'Overnight Visit, or correct the times.',
    };
  }
  return {
    ok: true,
    value: {
      startDate, endDate, startTime, endTime,
      visitType: 'day', dayCount: span + 1, nights: 0,
    },
  };
}

/* ── Payroll counts ────────────────────────────────────────────── */

export interface CountableVisit {
  start_date: string;
  visit_type: VisitType;
  status: VisitStatus;
  day_count: number;
  nights: number;
}

export interface VisitCounts {
  /** Quantity for the Outdoor Day Visit rule. */
  dayVisitDays: number;
  /** Quantity for the Outdoor Overnight Visit rule. */
  overnightVisits: number;
  /** Approved visits counted, for display. */
  visits: number;
}

/**
 * Approved visits for one payroll month, split by category.
 *
 * Only APPROVED visits count — pending and rejected ones never reach payroll.
 * A visit belongs to the month of its start date, and validation guarantees
 * it cannot straddle two months, so no visit can contribute to two periods.
 */
export function countVisitsForMonth(
  visits: readonly CountableVisit[], month: Date,
): VisitCounts {
  const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  let dayVisitDays = 0, overnightVisits = 0, counted = 0;
  for (const v of visits) {
    if (v.status !== 'approved') continue;
    if (!v.start_date.startsWith(prefix)) continue;
    counted++;
    // Exactly one category per visit — never both.
    if (v.visit_type === 'overnight') overnightVisits += 1;
    else dayVisitDays += v.day_count;
  }
  return { dayVisitDays, overnightVisits, visits: counted };
}
