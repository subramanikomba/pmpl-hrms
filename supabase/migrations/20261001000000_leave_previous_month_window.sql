-- Employees may now apply for leave dated in the PREVIOUS month, until the
-- 10th of the current month, so that leave can be regularised before payroll
-- for that month is run.
--
-- Previously the bound was `from_date >= date_trunc('month', current_date)`,
-- which closed the previous month the instant it ended — leaving an employee
-- who had been away with no way to convert an Absent day into paid leave.
--
-- The window is deliberately wider than the attendance self-marking window
-- (public.employee_may_mark, cut off on the 5th): applying for leave produces a
-- REQUEST that an Admin must approve, whereas self-marking attendance is
-- unsupervised. A longer supervised window is therefore safe.
--
-- Like employee_may_mark, the cutoff day is a constant rather than being read
-- from company_settings.salary_payment_day: it governs data entry, not payroll
-- locking, and the two were deliberately decoupled earlier.
--
-- Admin is unaffected: leave_admin grants ALL and can record leave for any date.

create or replace function public.employee_may_apply_leave(d date)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    d >= date_trunc('month', current_date)::date
    or (
      d >= (date_trunc('month', current_date) - interval '1 month')::date
      and d <  date_trunc('month', current_date)::date
      and extract(day from current_date) <= 10
    );
$function$;

comment on function public.employee_may_apply_leave(date) is
  'True when an employee may apply for leave dated d: the current month or '
  'later always, or the previous month while today is on or before the 10th. '
  'Client-side twin: employeeMayApplyLeave in src/lib/payroll.ts.';

-- No upper bound: leave may always be applied for a future date.
drop policy if exists leave_own_insert on public.leave_requests;
create policy leave_own_insert on public.leave_requests
  for insert with check (
    employee_id = public.current_employee_id()
    and public.employee_may_apply_leave(from_date)
    and to_date >= from_date
  );

drop policy if exists leave_own_update on public.leave_requests;
create policy leave_own_update on public.leave_requests
  for update
  using (employee_id = public.current_employee_id() and status = 'pending')
  with check (
    employee_id = public.current_employee_id()
    and public.employee_may_apply_leave(from_date)
    and to_date >= from_date
  );
