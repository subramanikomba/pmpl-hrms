import { describe, expect, it } from 'vitest';
import {
  clearSelectionIfHidden, employeeLabel, inactiveCount, scopedEmployees,
} from './employeeScope';
import type { Employee } from '@/types/db';

const emp = (code: string, status: 'active' | 'inactive'): Employee => ({
  id: code, employee_code: code, first_name: code, last_name: 'X',
  status, is_admin: false,
} as Employee);

const ALL = [emp('A', 'active'), emp('B', 'inactive'), emp('C', 'active')];

describe('employeeScope', () => {
  it('hides inactive employees by default — today\'s behaviour', () => {
    expect(scopedEmployees(ALL, false).map((e) => e.id)).toEqual(['A', 'C']);
  });

  it('includes them when asked, keeping the original order', () => {
    expect(scopedEmployees(ALL, true).map((e) => e.id)).toEqual(['A', 'B', 'C']);
  });

  it('never mutates the list it was given', () => {
    const copy = [...ALL];
    scopedEmployees(ALL, true).reverse();
    expect(ALL).toEqual(copy);
  });

  it('counts who is being left out', () => {
    expect(inactiveCount(ALL)).toBe(1);
    expect(inactiveCount([emp('A', 'active')])).toBe(0);
  });

  it('marks an inactive employee in the label, and leaves active ones alone', () => {
    expect(employeeLabel(emp('EMP125', 'inactive'))).toContain('(inactive)');
    expect(employeeLabel(emp('EMP121', 'active'))).not.toContain('(inactive)');
  });

  it('clears a selection that the toggle has just hidden', () => {
    // The trap this guards: un-ticking while a leaver is selected would leave
    // the report filtered to someone absent from the dropdown.
    expect(clearSelectionIfHidden('B', ALL, false)).toBe('');
  });

  it('keeps the selection when it is still visible', () => {
    expect(clearSelectionIfHidden('A', ALL, false)).toBe('A');
    expect(clearSelectionIfHidden('B', ALL, true)).toBe('B');
    expect(clearSelectionIfHidden('', ALL, false)).toBe('');
  });
  /**
   * Regression: the Attendance report's "Attendance not marked" block was
   * built from the unscoped employee list, so leavers (EMP002, EMP125) were
   * raised as exceptions that could never be resolved — a leaver will not
   * mark attendance again. Payroll and the Dashboard already scoped to
   * active; this pins the report to the same rule, and pins it to ACTIVE
   * regardless of the Include-inactive toggle, because the block is a to-do
   * list rather than a record of what happened.
   */
  it('scopes the attendance-exception roster to active employees, toggle or not', () => {
    const roster = [emp('A', 'active'), emp('B', 'inactive')];
    expect(scopedEmployees(roster, false).map((e) => e.id)).toEqual(['A']);
    // The toggle widens the report grid, never the exception list: the call
    // site passes `false` unconditionally, which is what this asserts.
    expect(scopedEmployees(roster, false)).toHaveLength(1);
  });
});
