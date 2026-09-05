/**
 * Data-access layer. Every Supabase query lives here so screens stay
 * declarative and query shapes are typed in exactly one place.
 *
 * Throws on error; callers surface the message via useQuery/useToast.
 */
import { supabase } from './supabase';
import { SUPABASE_URL } from './config';
import { isoDate, monthStart } from './payroll';
import type {
  ClientLocation, ClientWithLocations, AttendanceChangeRequest, AttendanceStatus,
  OutdoorVisit,
  AllowanceRule, AttendanceRecord, ClientCompany, CompanyAdvance,
  CompanyExpense, CompanyHoliday, CompanySettings, Employee, LeaveRequest,
  LedgerRow, PayrollRecord, SalaryAdvance, SalaryAdvanceRecovery,
  SalaryStructure, WithEmployee,
} from '@/types/db';

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error('No data returned');
  return res.data;
}
function unwrapList<T>(res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

const EMP_FIELDS = 'employee_code, first_name, last_name, designation';

/** Private Supabase Storage bucket holding expense receipts. */
export const RECEIPT_BUCKET = 'expense-receipts';
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/* ── Employees ─────────────────────────────────────────────────── */
export const employeesApi = {
  async list(includeInactive = true): Promise<Employee[]> {
    let q = supabase.from('employees').select('*').order('employee_code');
    if (!includeInactive) q = q.eq('status', 'active');
    return unwrapList<Employee>(await q);
  },
  async listActive(): Promise<Employee[]> {
    return employeesApi.list(false);
  },
  async update(id: string, patch: Partial<Employee>): Promise<void> {
    const { error } = await supabase.from('employees').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async setStatus(id: string, status: Employee['status']): Promise<void> {
    return employeesApi.update(id, { status });
  },
  /**
   * Reset an employee's password. Runs in an Edge Function because changing
   * another user's password needs the service role. Touches only auth —
   * attendance, payroll and historical records are unaffected.
   */
  async resetPassword(employeeId: string, password: string): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Your session has expired. Please sign in again.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/reset-employee-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ employee_id: employeeId, password }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? 'Could not reset password');
  },
  /**
   * Creating a login requires the service role, which must never reach the
   * browser — this calls the `create-employee` Edge Function instead.
   */
  async create(input: {
    email: string; password: string; first_name: string; last_name: string;
    designation?: string; pan?: string; phone?: string; is_admin: boolean;
  }): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Your session has expired. Please sign in again.');

    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/create-employee`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(input),
      },
    );
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? 'Failed to create employee');
  },
};

/* ── Salary structures ─────────────────────────────────────────── */
export const salaryApi = {
  async listFor(employeeId: string): Promise<SalaryStructure[]> {
    return unwrapList<SalaryStructure>(
      await supabase.from('salary_structures').select('*')
        .eq('employee_id', employeeId)
        .order('effective_from', { ascending: false }),
    );
  },
  async upsert(row: Omit<SalaryStructure, 'id'>): Promise<void> {
    const { error } = await supabase.from('salary_structures')
      .upsert(row, { onConflict: 'employee_id,effective_from' });
    if (error) throw new Error(error.message);
  },
  /**
   * Remove a revision. Callers must first confirm it has not been used by a
   * finalised payroll — see structureIsLocked — so historical payroll can
   * never lose the structure it was calculated from.
   */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('salary_structures')
      .delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

/* ── Attendance ────────────────────────────────────────────────── */
export const attendanceApi = {
  async listForMonth(month: Date, employeeId?: string): Promise<AttendanceRecord[]> {
    const from = isoDate(monthStart(month));
    const to = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    let q = supabase.from('attendance').select('*')
      .gte('date', from).lte('date', to).order('date', { ascending: false });
    if (employeeId) q = q.eq('employee_id', employeeId);
    return unwrapList<AttendanceRecord>(await q);
  },
  async markPresent(employeeId: string, date: string): Promise<void> {
    return attendanceApi.selfMark(employeeId, date, 'present');
  },
  /**
   * Employee marking their own present/absent. The permitted date window is
   * enforced by RLS (public.employee_may_mark); this is the client-side twin
   * so the UI can disable what the database would reject anyway.
   */
  async selfMark(
    employeeId: string, date: string, status: 'present' | 'absent',
  ): Promise<void> {
    const { error } = await supabase.from('attendance').upsert(
      { employee_id: employeeId, date, status, marked_by: employeeId },
      { onConflict: 'employee_id,date' },
    );
    if (error) throw new Error(error.message);
  },
  async setStatus(
    employeeId: string, date: string,
    status: AttendanceRecord['status'], markedBy: string,
  ): Promise<void> {
    const { error } = await supabase.from('attendance').upsert(
      { employee_id: employeeId, date, status, marked_by: markedBy },
      { onConflict: 'employee_id,date' },
    );
    if (error) throw new Error(error.message);
  },
};

/* ── Attendance change requests (past Absent -> Present) ───────── */
export const attendanceChangeApi = {
  /** The employee's own requests, newest first. */
  async listFor(employeeId: string): Promise<AttendanceChangeRequest[]> {
    return unwrapList<AttendanceChangeRequest>(
      await supabase.from('attendance_change_requests').select('*')
        .eq('employee_id', employeeId).order('date', { ascending: false }),
    );
  },
  async listAll(
    status?: AttendanceChangeRequest['status'],
  ): Promise<WithEmployee<AttendanceChangeRequest>[]> {
    let q = supabase.from('attendance_change_requests')
      .select(`*, employees!employee_id(${EMP_FIELDS})`)
      .order('date', { ascending: false });
    if (status) q = q.eq('status', status);
    return unwrapList<WithEmployee<AttendanceChangeRequest>>(await q);
  },
  /**
   * Raise a correction request. The permitted window and the past-date rule
   * are enforced by RLS (acr_own_insert); this is the client-side twin.
   */
  async raise(input: {
    employee_id: string; date: string;
    from_status: AttendanceStatus | null; reason: string | null;
  }): Promise<void> {
    const { error } = await supabase.from('attendance_change_requests').insert({
      ...input, to_status: 'present', status: 'pending',
    });
    if (error) throw new Error(error.message);
  },
  /** Withdraw an undecided request. */
  async withdraw(id: string): Promise<void> {
    const { error } = await supabase.from('attendance_change_requests')
      .delete().eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },
  /**
   * Record the Admin decision. Scoped to status='pending' so a request can
   * never be decided twice. Writing the attendance row itself is done by the
   * caller through attendanceApi.setStatus, under the admin RLS policy.
   */
  async decide(
    id: string, status: 'approved' | 'rejected',
    reviewerId: string, note?: string,
  ): Promise<void> {
    const { error } = await supabase.from('attendance_change_requests').update({
      status, reviewed_by: reviewerId, review_note: note ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },
};

/* ── Outdoor / site visits ─────────────────────────────────────── */
/** Fields the client may write. The derived columns are computed in Postgres. */
export type OutdoorVisitInput = Pick<
  OutdoorVisit,
  'employee_id' | 'start_date' | 'end_date' | 'start_time' | 'end_time'
  | 'visit_type' | 'client_id' | 'client_location_id' | 'location' | 'purpose'
>;

export const outdoorVisitApi = {
  async listFor(employeeId: string): Promise<OutdoorVisit[]> {
    return unwrapList<OutdoorVisit>(
      await supabase.from('outdoor_visits').select('*')
        .eq('employee_id', employeeId).order('start_date', { ascending: false }),
    );
  },
  /** Admin view, optionally bounded to a period. */
  async listAll(range?: { from?: string; to?: string; employeeId?: string }):
  Promise<WithEmployee<OutdoorVisit>[]> {
    let q = supabase.from('outdoor_visits')
      .select(`*, employees!employee_id(${EMP_FIELDS})`)
      .order('start_date', { ascending: false });
    if (range?.from) q = q.gte('start_date', range.from);
    if (range?.to) q = q.lte('start_date', range.to);
    if (range?.employeeId) q = q.eq('employee_id', range.employeeId);
    return unwrapList<WithEmployee<OutdoorVisit>>(await q);
  },
  /**
   * Visits overlapping a payroll month, used to suggest allowance quantities.
   * Bounded by start_date so a visit is counted in the month it began.
   */
  async listPending(): Promise<WithEmployee<OutdoorVisit>[]> {
    return unwrapList<WithEmployee<OutdoorVisit>>(
      await supabase.from('outdoor_visits')
        .select(`*, employees!employee_id(${EMP_FIELDS})`)
        .eq('status', 'pending').order('start_date', { ascending: false }),
    );
  },
  async listForMonth(month: Date): Promise<OutdoorVisit[]> {
    const from = isoDate(monthStart(month));
    const to = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    return unwrapList<OutdoorVisit>(
      await supabase.from('outdoor_visits').select('*')
        .gte('start_date', from).lte('start_date', to),
    );
  },
  async create(input: OutdoorVisitInput): Promise<void> {
    const { error } = await supabase.from('outdoor_visits')
      .insert({ ...input, status: 'pending' });
    if (error) throw new Error(error.message);
  },
  /**
   * Admin decision. Scoped to status='pending' so a visit can never be
   * decided twice, and the confirmed category is written with the decision.
   */
  async decide(
    id: string, status: 'approved' | 'rejected', adminId: string,
    visitType: OutdoorVisit['visit_type'], note?: string,
  ): Promise<void> {
    const { error } = await supabase.from('outdoor_visits').update({
      status, visit_type: visitType, approved_by: adminId,
      approved_at: new Date().toISOString(), review_note: note ?? null,
    }).eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },
  /** Admin correction of a pending visit before approving it. */
  async amend(id: string, patch: Partial<OutdoorVisitInput>): Promise<void> {
    const { error } = await supabase.from('outdoor_visits')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },
  async update(id: string, patch: Partial<OutdoorVisitInput>): Promise<void> {
    const { error } = await supabase.from('outdoor_visits')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('outdoor_visits').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

/* ── Leave ─────────────────────────────────────────────────────── */
export const leaveApi = {
  async listFor(employeeId: string): Promise<LeaveRequest[]> {
    return unwrapList<LeaveRequest>(
      await supabase.from('leave_requests').select('*')
        .eq('employee_id', employeeId).order('from_date', { ascending: false }),
    );
  },
  async listAll(status?: LeaveRequest['status']): Promise<WithEmployee<LeaveRequest>[]> {
    let q = supabase.from('leave_requests')
      .select(`*, employees!employee_id(${EMP_FIELDS})`)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    return unwrapList<WithEmployee<LeaveRequest>>(await q);
  },
  async apply(input: {
    employee_id: string; from_date: string; to_date: string; reason: string;
  }): Promise<void> {
    const { error } = await supabase.from('leave_requests').insert({
      ...input, leave_type: 'paid_leave', status: 'pending',
    });
    if (error) throw new Error(error.message);
  },
  async decide(
    id: string, status: 'approved' | 'rejected',
    reviewerId: string, note?: string,
    /** Admin's paid/unpaid choice, recorded with the approval. */
    leaveType?: LeaveRequest['leave_type'],
  ): Promise<void> {
    const { error } = await supabase.from('leave_requests').update({
      status, reviewed_by: reviewerId, review_note: note ?? null,
      reviewed_at: new Date().toISOString(),
      ...(leaveType ? { leave_type: leaveType } : {}),
    }).eq('id', id);
    if (error) throw new Error(error.message);
  },
};

/* ── Company expenses & advances ───────────────────────────────── */
export const expenseApi = {
  async listFor(employeeId: string): Promise<CompanyExpense[]> {
    return unwrapList<CompanyExpense>(
      await supabase.from('company_expenses').select('*')
        .eq('employee_id', employeeId).order('expense_date', { ascending: false }),
    );
  },
  async listAll(filters: {
    status?: CompanyExpense['status']; employeeId?: string; category?: string;
    clientId?: string; from?: string; to?: string;
  } = {}): Promise<WithEmployee<CompanyExpense>[]> {
    let q = supabase.from('company_expenses')
      .select(`*, employees!employee_id(${EMP_FIELDS})`)
      .order('expense_date', { ascending: false });
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.employeeId) q = q.eq('employee_id', filters.employeeId);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.clientId) q = q.eq('client_id', filters.clientId);
    if (filters.from) q = q.gte('expense_date', filters.from);
    if (filters.to) q = q.lte('expense_date', filters.to);
    return unwrapList<WithEmployee<CompanyExpense>>(await q);
  },
  async submit(
    input: Omit<CompanyExpense,
      'id' | 'status' | 'accounted_advance_id' | 'accounted_amount'
      | 'reviewed_by' | 'review_note' | 'reviewed_at' | 'created_at'>,
    receipt?: File | null,
  ): Promise<void> {
    // Insert first so the row id can key the stored object; the receipt is
    // uploaded only on submit, never while the user is still filling the form.
    const { data, error } = await supabase.from('company_expenses')
      .insert({ ...input, status: 'pending' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    if (!receipt) return;

    const row = data as { id: string };
    const ext = (receipt.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `${input.employee_id}/${row.id}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .upload(path, receipt, { upsert: true, contentType: receipt.type });

    if (upErr) {
      // Keep the expense and the stored path consistent: if the upload fails,
      // remove the row rather than leaving a claim pointing at nothing.
      await supabase.from('company_expenses').delete().eq('id', row.id);
      throw new Error(`Receipt upload failed: ${upErr.message}`);
    }

    const { error: linkErr } = await supabase.from('company_expenses')
      .update({ receipt_url: path }).eq('id', row.id);
    if (linkErr) throw new Error(linkErr.message);
  },

  /**
   * Receipts live in a private bucket, so a short-lived signed URL is minted
   * on demand rather than storing a public link.
   */
  async receiptUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from(RECEIPT_BUCKET).createSignedUrl(path, 300);
    if (error || !data) throw new Error(error?.message ?? 'Could not open receipt');
    return data.signedUrl;
  },
  /**
   * Update a claim the employee still owns. Guarded by `status = 'pending'`
   * so an approved claim can never be altered, even if the UI is bypassed —
   * RLS already restricts this to the claim's own employee.
   */
  async updateOwn(id: string, patch: {
    expense_date: string; category: string; amount: number;
    bill_number: string | null; description: string | null;
    client_id: string | null; client_location_id: string | null;
    paid_from_advance: boolean;
  }, receipt?: File | null): Promise<void> {
    let receipt_url: string | undefined;
    if (receipt) {
      const ext = receipt.name.split('.').pop()?.toLowerCase() ?? 'bin';
      const { data: existing } = await supabase.from('company_expenses')
        .select('employee_id').eq('id', id).single();
      const employeeId = (existing as { employee_id: string } | null)?.employee_id;
      if (!employeeId) throw new Error('Expense not found');
      const path = `${employeeId}/${id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(RECEIPT_BUCKET).upload(path, receipt, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      receipt_url = path;
    }
    const { error } = await supabase.from('company_expenses')
      .update(receipt_url ? { ...patch, receipt_url } : patch)
      .eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },
  /**
   * Spec: an expense need not relate to an advance. If `advanceId` is given
   * the approved amount is accounted against that outstanding advance.
   */
  /**
   * Update a claim the employee still owns. Scoped to status='pending' so an
   * approved claim can never be altered — RLS enforces the same rule.
   */
  async updatePending(
    id: string,
    employeeId: string,
    patch: Partial<Pick<CompanyExpense,
      'expense_date' | 'category' | 'amount' | 'bill_number'
      | 'description' | 'client_id' | 'paid_from_advance'>>,
    receipt?: File | null,
  ): Promise<void> {
    let receipt_url: string | undefined;
    if (receipt) {
      // Same path scheme as submit(), so storage RLS (folder = employee id)
      // continues to apply. upsert replaces an earlier receipt.
      const ext = (receipt.name.split('.').pop() ?? 'bin').toLowerCase();
      const path = `${employeeId}/${id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(path, receipt, { upsert: true, contentType: receipt.type });
      if (upErr) throw new Error(`Receipt upload failed: ${upErr.message}`);
      receipt_url = path;
    }
    const { error } = await supabase.from('company_expenses')
      .update(receipt_url ? { ...patch, receipt_url } : patch)
      .eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },
  /** Withdraw a claim that has not been approved yet. */
  async deletePending(id: string): Promise<void> {
    const { error } = await supabase.from('company_expenses')
      .delete().eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },
  async approve(
    id: string, reviewerId: string,
    accounting?: { advanceId: string; amount: number },
  ): Promise<void> {
    const { error } = await supabase.from('company_expenses').update({
      status: 'approved', reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      accounted_advance_id: accounting?.advanceId ?? null,
      accounted_amount: accounting?.amount ?? null,
    }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  /**
   * Account an ALREADY-APPROVED claim against an advance. Corrects the case
   * where approval happened without selecting an advance.
   */
  async accountAgainstAdvance(
    id: string, advanceId: string, amount: number,
  ): Promise<void> {
    const { error } = await supabase.from('company_expenses').update({
      accounted_advance_id: advanceId,
      accounted_amount: amount,
    }).eq('id', id).eq('status', 'approved');
    if (error) throw new Error(error.message);
  },
  /**
   * Reverse an accounting entry — the claim stays approved but stops
   * settling the advance, so the outstanding balance goes back up.
   */
  async unaccount(id: string): Promise<void> {
    const { error } = await supabase.from('company_expenses').update({
      accounted_advance_id: null,
      accounted_amount: null,
    }).eq('id', id).eq('status', 'approved');
    if (error) throw new Error(error.message);
  },
  async reject(id: string, reviewerId: string, note?: string): Promise<void> {
    const { error } = await supabase.from('company_expenses').update({
      status: 'rejected', reviewed_by: reviewerId, review_note: note ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const advanceApi = {
  async listFor(employeeId: string): Promise<CompanyAdvance[]> {
    return unwrapList<CompanyAdvance>(
      await supabase.from('company_advances').select('*')
        .eq('employee_id', employeeId).order('advance_date'),
    );
  },
  async listAll(): Promise<CompanyAdvance[]> {
    return unwrapList<CompanyAdvance>(
      await supabase.from('company_advances').select('*').order('advance_date'),
    );
  },
  /**
   * The same ledger view across every employee, for the company-wide summary.
   * One query rather than one per employee, and the view stays the single
   * source of truth for advance/expense balances.
   */
  async ledgerAll(): Promise<LedgerRow[]> {
    return unwrapList<LedgerRow>(
      await supabase.from('company_advance_ledger').select('*').order('txn_date'),
    );
  },
  async ledgerFor(employeeId: string): Promise<LedgerRow[]> {
    return unwrapList<LedgerRow>(
      await supabase.from('company_advance_ledger').select('*')
        .eq('employee_id', employeeId).order('txn_date'),
    );
  },
  async give(input: {
    employee_id: string; advance_date: string; amount: number;
    reference: string; note: string; given_by: string;
  }): Promise<void> {
    const { error } = await supabase.from('company_advances').insert(input);
    if (error) throw new Error(error.message);
  },
};

/* ── Salary advance (kept separate from company advance, per spec) ── */
export const salaryAdvanceApi = {
  async listAll(): Promise<SalaryAdvance[]> {
    return unwrapList<SalaryAdvance>(
      await supabase.from('salary_advances').select('*')
        .order('advance_date', { ascending: false }),
    );
  },
  async listFor(employeeId: string): Promise<SalaryAdvance[]> {
    return unwrapList<SalaryAdvance>(
      await supabase.from('salary_advances').select('*')
        .eq('employee_id', employeeId).order('advance_date'),
    );
  },
  async recoveries(employeeId?: string): Promise<SalaryAdvanceRecovery[]> {
    let q = supabase.from('salary_advance_recoveries').select('*');
    if (employeeId) q = q.eq('employee_id', employeeId);
    return unwrapList<SalaryAdvanceRecovery>(await q);
  },
  async give(input: {
    employee_id: string; advance_date: string; amount: number;
    note: string; given_by: string;
  }): Promise<void> {
    const { error } = await supabase.from('salary_advances').insert(input);
    if (error) throw new Error(error.message);
  },
  async recordRecovery(input: {
    salary_advance_id: string; employee_id: string;
    payroll_month: string; recovered_amount: number;
  }): Promise<void> {
    const { error } = await supabase.from('salary_advance_recoveries').insert(input);
    if (error) throw new Error(error.message);
  },
  /**
   * Make the recovery ledger match the payroll figure for one employee-month.
   *
   * Payroll can be re-saved with a corrected amount, so the previous rows for
   * that month are cleared and the current amount re-recorded. Without this
   * the ledger and payroll.salary_advance_recovered silently diverge.
   */
  async syncRecovery(input: {
    employee_id: string; payroll_month: string;
    salary_advance_id: string | null; recovered_amount: number;
  }): Promise<void> {
    const { error: delErr } = await supabase
      .from('salary_advance_recoveries').delete()
      .eq('employee_id', input.employee_id)
      .eq('payroll_month', input.payroll_month);
    if (delErr) throw new Error(delErr.message);

    if (input.recovered_amount > 0 && input.salary_advance_id) {
      const { error } = await supabase.from('salary_advance_recoveries').insert({
        salary_advance_id: input.salary_advance_id,
        employee_id: input.employee_id,
        payroll_month: input.payroll_month,
        recovered_amount: input.recovered_amount,
      });
      if (error) throw new Error(error.message);
    }
  },
};

/* ── Payroll ───────────────────────────────────────────────────── */
export const payrollApi = {
  async listForMonth(month: Date): Promise<PayrollRecord[]> {
    return unwrapList<PayrollRecord>(
      await supabase.from('payroll').select('*')
        .eq('payroll_month', isoDate(monthStart(month))),
    );
  },
  /** Same month view, with employee names, for admin payment summaries. */
  async listForMonthWithEmployee(
    month: Date,
  ): Promise<WithEmployee<PayrollRecord>[]> {
    return unwrapList<WithEmployee<PayrollRecord>>(
      await supabase.from('payroll')
        .select(`*, employees!employee_id(${EMP_FIELDS})`)
        .eq('payroll_month', isoDate(monthStart(month))),
    );
  },
  /** Every payroll row for one employee, used to protect salary revisions. */
  async listForEmployee(employeeId: string): Promise<PayrollRecord[]> {
    return unwrapList<PayrollRecord>(
      await supabase.from('payroll').select('*')
        .eq('employee_id', employeeId)
        .order('payroll_month', { ascending: false }),
    );
  },
  async listForYear(fyStartYear: number): Promise<WithEmployee<PayrollRecord>[]> {
    return unwrapList<WithEmployee<PayrollRecord>>(
      await supabase.from('payroll')
        .select(`*, employees!employee_id(${EMP_FIELDS})`)
        .gte('payroll_month', `${fyStartYear}-04-01`)
        .lte('payroll_month', `${fyStartYear + 1}-03-31`)
        .order('payroll_month'),
    );
  },
  async getOne(employeeId: string, month: Date): Promise<PayrollRecord | null> {
    const { data, error } = await supabase.from('payroll').select('*')
      .eq('employee_id', employeeId)
      .eq('payroll_month', isoDate(monthStart(month)))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as PayrollRecord | null) ?? null;
  },
  async save(row: Partial<PayrollRecord> & {
    employee_id: string; payroll_month: string;
  }): Promise<void> {
    const { error } = await supabase.from('payroll')
      .upsert(row, { onConflict: 'employee_id,payroll_month' });
    if (error) throw new Error(error.message);
  },
  /**
   * Record payment details and move the record to 'paid'. Only a processed
   * record can be paid — a draft has no confirmed figures to pay against.
   */
  async recordPayment(id: string, payment: {
    payment_date: string; payment_mode: string; cheque_utr: string | null;
  }): Promise<void> {
    const { error } = await supabase.from('payroll').update({
      ...payment, status: 'paid',
    }).eq('id', id).eq('status', 'processed');
    if (error) throw new Error(error.message);
  },
  /** Undo a payment entry, returning the record to 'processed'. */
  async clearPayment(id: string): Promise<void> {
    const { error } = await supabase.from('payroll').update({
      payment_date: null, payment_mode: null, cheque_utr: null,
      status: 'processed',
    }).eq('id', id).eq('status', 'paid');
    if (error) throw new Error(error.message);
  },
  async reopen(id: string, adminId: string, reason: string): Promise<void> {
    const { error } = await supabase.from('payroll').update({
      is_locked: false, is_reopened: true, reopened_by: adminId,
      reopened_at: new Date().toISOString(), reopened_reason: reason,
    }).eq('id', id);
    if (error) throw new Error(error.message);
    await supabase.from('payroll_audit').insert({
      payroll_id: id, action: 'reopened', performed_by: adminId, note: reason,
    });
  },
};

/* ── Settings & reference data ─────────────────────────────────── */
export const settingsApi = {
  async get(): Promise<CompanySettings> {
    const { data, error } = await supabase.from('company_settings')
      .select('*').limit(1).single();
    if (error) throw new Error(error.message);
    return data as CompanySettings;
  },
  async update(id: string, patch: Partial<CompanySettings>): Promise<void> {
    const { error } = await supabase.from('company_settings')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const holidayApi = {
  async list(): Promise<CompanyHoliday[]> {
    return unwrapList<CompanyHoliday>(
      await supabase.from('company_holidays').select('*').order('holiday_date'),
    );
  },
  async listBetween(from: string, to: string): Promise<CompanyHoliday[]> {
    return unwrapList<CompanyHoliday>(
      await supabase.from('company_holidays').select('*')
        .gte('holiday_date', from).lte('holiday_date', to),
    );
  },
  async add(holiday_date: string, name: string): Promise<void> {
    const { error } = await supabase.from('company_holidays')
      .insert({ holiday_date, name });
    if (error) throw new Error(error.message);
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('company_holidays').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const rulesApi = {
  async list(): Promise<AllowanceRule[]> {
    return unwrapList<AllowanceRule>(
      await supabase.from('allowance_rules').select('*').order('rule_key'),
    );
  },
  async update(id: string, patch: Partial<AllowanceRule>): Promise<void> {
    const { error } = await supabase.from('allowance_rules').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const clientApi = {
  async list(activeOnly = false): Promise<ClientCompany[]> {
    let q = supabase.from('client_companies').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    return unwrapList<ClientCompany>(await q);
  },
  /** Active locations for one client, for the employee-facing pickers. */
  async locationsFor(clientId: string): Promise<ClientLocation[]> {
    return unwrapList<ClientLocation>(
      await supabase.from('client_locations').select('*')
        .eq('client_id', clientId).eq('is_active', true).order('name'),
    );
  },
  /** Companies with their locations, for the settings panel. */
  async listWithLocations(): Promise<ClientWithLocations[]> {
    const rows = unwrapList<ClientCompany & { client_locations: ClientLocation[] | null }>(
      await supabase.from('client_companies')
        .select('*, client_locations(*)').order('name'),
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, is_active: r.is_active,
      locations: (r.client_locations ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  },
  /** Create a company and, optionally, its initial locations in one step. */
  async add(name: string, locations: string[] = []): Promise<void> {
    const { data, error } = await supabase.from('client_companies')
      .insert({ name }).select('id').single();
    if (error) throw new Error(error.message);
    const clean = locations.map((l) => l.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const { error: locErr } = await supabase.from('client_locations')
      .insert(clean.map((l) => ({ client_id: (data as { id: string }).id, name: l })));
    if (locErr) throw new Error(locErr.message);
  },
  /** Rename only. Descriptive change — never touches payroll or expenses. */
  async rename(id: string, name: string): Promise<void> {
    const { error } = await supabase.from('client_companies')
      .update({ name }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async setActive(id: string, is_active: boolean): Promise<void> {
    const { error } = await supabase.from('client_companies')
      .update({ is_active }).eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const locationApi = {
  async listFor(clientId: string): Promise<ClientLocation[]> {
    return unwrapList<ClientLocation>(
      await supabase.from('client_locations').select('*')
        .eq('client_id', clientId).order('name'),
    );
  },
  async add(clientId: string, name: string): Promise<void> {
    const { error } = await supabase.from('client_locations')
      .insert({ client_id: clientId, name: name.trim() });
    if (error) throw new Error(error.message);
  },
  async rename(id: string, name: string): Promise<void> {
    const { error } = await supabase.from('client_locations')
      .update({ name: name.trim() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('client_locations').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export { unwrap, unwrapList };
