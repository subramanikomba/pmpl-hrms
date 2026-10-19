import type { Employee } from '@/types/db';

/**
 * Reports follow MONEY and RECORDS, not employment.
 *
 * Someone who has left still has the expenses they claimed, the advances they
 * held and the salary slips they were paid, so excluding them from a report
 * makes the report wrong. But listing every leaver by default would clutter
 * the common case, so each report offers a quiet opt-in and keeps today's
 * behaviour until it is ticked.
 *
 * Payroll deliberately does NOT use this: that screen is about who is being
 * paid this month, where a leaver would be noise rather than an omission.
 */

/** Employees to show, given the toggle. */
export function scopedEmployees(
  all: readonly Employee[],
  includeInactive: boolean,
): Employee[] {
  return includeInactive
    ? [...all]
    : all.filter((e) => e.status === 'active');
}

/** How many are being left out right now. Drives whether the toggle shows. */
export function inactiveCount(all: readonly Employee[]): number {
  return all.filter((e) => e.status !== 'active').length;
}

/**
 * "EMP125 — Ramprasad Sharma (inactive)". The suffix matters: without it a
 * leaver in the list looks like a current employee, and the figures against
 * them would be read as live.
 */
export function employeeLabel(e: Employee): string {
  const name = `${e.employee_code} — ${e.first_name} ${e.last_name}`;
  return e.status === 'active' ? name : `${name} (inactive)`;
}

/**
 * Keep a selection valid when the toggle is turned OFF.
 *
 * Without this, un-ticking the box while an inactive employee is selected
 * would leave the report filtered to someone who is no longer in the list —
 * the filter would look like "All employees" while showing one person's rows.
 */
export function clearSelectionIfHidden(
  selectedId: string,
  all: readonly Employee[],
  includeInactive: boolean,
): string {
  if (!selectedId || includeInactive) return selectedId;
  const picked = all.find((e) => e.id === selectedId);
  return picked && picked.status !== 'active' ? '' : selectedId;
}
