/** Domain types mirroring the Supabase schema (Phase 1 spec). */
import type { VisitStatus, VisitType } from '@/lib/visits';

export type EmployeeStatus = 'active' | 'inactive';
export type AttendanceStatus =
  | 'present' | 'paid_leave' | 'unpaid_leave' | 'weekly_off'
  | 'company_holiday' | 'absent';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type PayrollStatus = 'draft' | 'processed' | 'paid';

export interface Employee {
  id: string;
  auth_user_id: string | null;
  employee_code: string;
  first_name: string;
  last_name: string;
  /** Required — this is the Supabase Auth login identity. */
  contact_email: string;
  /** Contact information only. Never used for authentication. */
  phone: string | null;
  designation: string | null;
  pan: string | null;
  is_admin: boolean;
  status: EmployeeStatus;
}

export interface SalaryStructure {
  id: string;
  employee_id: string;
  effective_from: string;
  basic: number;
  hra: number;
  special_allowance: number;
  transport_allowance: number;
  medical_allowance: number;
  conveyance_other: number;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  status: AttendanceStatus;
  marked_by: string | null;
}

/**
 * A past-dated request to change attendance to Present. Raised by the
 * employee, decided by Admin; approval writes the attendance record.
 */
export interface AttendanceChangeRequest {
  id: string;
  employee_id: string;
  date: string;
  /** Status before the request; null when the day was never marked. */
  from_status: AttendanceStatus | null;
  to_status: 'present';
  reason: string | null;
  status: ApprovalStatus;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * A record of an outdoor / site visit. Carries NO money: reimbursement stays
 * in company_expenses. This exists so allowance rules can be given real
 * quantities (nights stayed, day visits, multiday visits).
 *
 * nights, day_count, is_overnight and is_multiday are generated columns in
 * Postgres — derived from the dates once, never written by the client.
 */
export interface OutdoorVisit {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  /** Mandatory: the times are what distinguish day from overnight. */
  start_time: string;
  end_time: string;
  visit_type: VisitType;
  status: VisitStatus;
  approved_by: string | null;
  approved_at: string | null;
  review_note: string | null;
  client_id: string | null;
  location: string;
  purpose: string | null;
  created_at: string;
  updated_at: string;
  /** Generated in Postgres, per category — never both at once. */
  nights: number;
  day_count: number;
  is_overnight: boolean;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  from_date: string;
  to_date: string;
  leave_type: 'paid_leave' | 'unpaid_leave';
  reason: string | null;
  status: ApprovalStatus;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface CompanyAdvance {
  id: string;
  employee_id: string;
  advance_date: string;
  amount: number;
  reference: string | null;
  note: string | null;
}

export interface CompanyExpense {
  id: string;
  employee_id: string;
  expense_date: string;
  category: string;
  amount: number;
  bill_number: string | null;
  description: string | null;
  client_id: string | null;
  /** Storage object path in the private expense-receipts bucket. */
  receipt_url: string | null;
  status: ApprovalStatus;
  accounted_advance_id: string | null;
  accounted_amount: number | null;
  /** Employee hint only — never decides the accounting. */
  paid_from_advance: boolean;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface SalaryAdvance {
  id: string;
  employee_id: string;
  advance_date: string;
  amount: number;
  note: string | null;
}

export interface SalaryAdvanceRecovery {
  id: string;
  salary_advance_id: string;
  employee_id: string;
  payroll_month: string;
  recovered_amount: number;
}

export interface PayrollRecord {
  id: string;
  employee_id: string;
  payroll_month: string;
  days_in_month: number;
  paid_days: number;
  basic: number;
  hra: number;
  special_allowance: number;
  transport_allowance: number;
  medical_allowance: number;
  conveyance_other: number;
  performance_bonus: number;
  annual_bonus: number;
  /** Total of the configured allowance rules applied this month. */
  allowances_total: number;
  /** Per-rule breakdown, so a saved payroll can be reopened and reviewed. */
  allowances_detail: AllowanceLine[] | null;
  gross_salary: number;
  professional_tax: number;
  salary_advance_recovered: number;
  other_deductions: number;
  other_deductions_note: string | null;
  total_deductions: number;
  net_salary: number;
  payment_date: string | null;
  payment_mode: string | null;
  cheque_utr: string | null;
  status: PayrollStatus;
  is_locked: boolean;
  is_reopened: boolean;
  reopened_reason: string | null;
}

/** One configured allowance rule as applied to a specific payroll month. */
export interface AllowanceLine {
  rule_key: string;
  description: string;
  rate_percent: number;
  /** The Count actually used for payroll — Admin's figure. */
  quantity: number;
  /**
   * What the system derived from the records. Retained so a manual override
   * stays visible after the fact; these Counts affect salary.
   */
  system_quantity?: number;
  override_reason?: string | null;
  amount: number;
}

export interface CompanySettings {
  id: string;
  company_name: string;
  address: string | null;
  cin: string | null;
  gst_number: string | null;
  salary_payment_day: number;
  /** Working days as day-of-week numbers (0=Sun..6=Sat). Others are weekly offs. */
  working_days: number[];
  pt_monthly: number;
  pt_february: number;
  /** End-of-day cutoff for raising Attendance Not Marked exceptions. */
  attendance_cutoff_time: string;
}

export interface CompanyHoliday {
  id: string;
  holiday_date: string;
  name: string;
}

export interface AllowanceRule {
  id: string;
  rule_key: string;
  description: string;
  rate_percent: number;
  is_active: boolean;
}

export interface ClientCompany {
  id: string;
  name: string;
  is_active: boolean;
}

/** A site/plant belonging to a client company. Descriptive data only. */
export interface ClientLocation {
  id: string;
  client_id: string;
  name: string;
  is_active: boolean;
}

export type ClientWithLocations = ClientCompany & { locations: ClientLocation[] };

export interface LedgerRow {
  employee_id: string;
  txn_date: string;
  txn_type: 'advance' | 'expense';
  txn_id: string;
  debit: number;
  credit: number;
  reference: string | null;
  description: string | null;
  running_balance: number;
}

/** Employee joined onto another row (Supabase embedded select). */
export type WithEmployee<T> = T & {
  employees: Pick<
    Employee, 'employee_code' | 'first_name' | 'last_name' | 'designation'
  > | null;
};
