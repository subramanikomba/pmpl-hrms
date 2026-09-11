/**
 * Outdoor visit rules.
 *
 * The business recognises exactly TWO categories and no third:
 *   - Day visit:       out and back the same day, possibly repeated over
 *                      several days. Paid per DAY.
 *                      day_count = end - start + 1, nights = 0.
 *   - Overnight visit: the employee stays away. Paid per NIGHT.
 *                      day_count = end - start + 1, nights = end - start.
 *                      Must span at least one night.
 *
 * Days are counted the same way for both, and both values are retained for
 * display, but an approved visit supplies a quantity to exactly ONE allowance
 * rule — never both — so a trip is never paid at two rates.
 *
 * The employee's chosen visit_type decides the category. Times are recorded
 * for the record only and no longer constrain it: an overnight trip may leave
 * during the day.
 *
 * Everything here is pure so the same rules can run in the form, in the
 * approval dialog and in the payroll count derivation.
 */

export type VisitType = 'day' | 'overnight';
export type VisitStatus = 'pending' | 'approved' | 'rejected';

/** Sanity guard on a single visit, mirroring ov_span_sane in Postgres. */
export const MAX_VISIT_SPAN_DAYS = 60;

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
  const span = daysBetween(startDate, endDate);
  // Sanity guard, mirroring the ov_span_sane database constraint.
  if (span > MAX_VISIT_SPAN_DAYS) {
    return {
      ok: false,
      error: `A single visit cannot be longer than ${MAX_VISIT_SPAN_DAYS} days.`,
    };
  }

  if (visitType === 'overnight') {
    if (span < 1) {
      return {
        ok: false,
        error: 'An overnight visit must return on a later date than it starts. '
          + 'For a trip out and back the same day, choose Outdoor Day Visit.',
      };
    }
    // Times are informational: an overnight trip may leave during the day.
    return {
      ok: true,
      value: {
        startDate, endDate, startTime, endTime,
        visitType: 'overnight', dayCount: span + 1, nights: span,
      },
    };
  }

  // Day visit. Only a same-day visit constrains the times, since for a
  // multi-day one they describe first departure and last return.
  if (span === 0 && minutesOf(endTime) <= minutesOf(startTime)) {
    return {
      ok: false,
      error: 'For a same-day visit the end time must be later than the start time.',
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
  /** The return date. This, not start_date, decides the payroll month. */
  end_date: string;
  visit_type: VisitType;
  status: VisitStatus;
  day_count: number;
  nights: number;
}

export interface VisitCounts {
  /** Quantity for the Outdoor Day Visit rule. */
  dayVisitDays: number;
  /** Quantity for the Outdoor Overnight Visit rule — NIGHTS, not visits. */
  overnightNights: number;
  /** Approved visits counted, for display. */
  visits: number;
}

/**
 * Approved visits for one payroll month, split by category.
 *
 * Only APPROVED visits count — pending and rejected ones never reach payroll.
 *
 * A visit belongs ENTIRELY to the payroll month containing its end_date (the
 * return date) and is never split across two months. A 29 Sep - 2 Oct trip
 * counts wholly in October; September gets nothing for it.
 */
export function countVisitsForMonth(
  visits: readonly CountableVisit[], month: Date,
): VisitCounts {
  const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  let dayVisitDays = 0, overnightNights = 0, counted = 0;
  for (const v of visits) {
    if (v.status !== 'approved') continue;
    // The RETURN date decides the payroll month, so a cross-month trip is
    // counted once, in the month it ended.
    if (!v.end_date.startsWith(prefix)) continue;
    counted++;
    // Exactly one category per visit — never both. An overnight visit
    // supplies nights; a day visit supplies days.
    if (v.visit_type === 'overnight') overnightNights += v.nights;
    else dayVisitDays += v.day_count;
  }
  return { dayVisitDays, overnightNights, visits: counted };
}
