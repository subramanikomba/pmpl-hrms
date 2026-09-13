-- Employees may now apply for leave on a PAST date within the current month,
-- so a day already taken off can be regularised as paid leave instead of
-- being left as Absent — the weekend-swap case, where someone works a Sunday
-- and takes the Monday off.
--
-- Previously the future-only rule lived only in the UI, with no bound in the
-- database at all: an employee could have applied for leave in any past month.
-- This adds the bound the relaxed rule needs.
--
-- Admin is unaffected: leave_admin grants ALL and can record leave for any
-- date, including earlier months.
drop policy if exists leave_own_insert on public.leave_requests;
create policy leave_own_insert on public.leave_requests
  for insert with check (
    employee_id = public.current_employee_id()
    and from_date >= date_trunc('month', current_date)::date
    and to_date >= from_date
  );

drop policy if exists leave_own_update on public.leave_requests;
create policy leave_own_update on public.leave_requests
  for update
  using (employee_id = public.current_employee_id() and status = 'pending')
  with check (
    employee_id = public.current_employee_id()
    and from_date >= date_trunc('month', current_date)::date
    and to_date >= from_date
  );
