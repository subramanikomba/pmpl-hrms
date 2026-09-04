-- 1. Attendance edit window: the PREVIOUS month stays editable until the 5th
--    of the current month (previously: the day before the salary payment day).
--    Derived from current_date, so it rolls over months and years by itself.
create or replace function public.employee_may_mark(d date)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    d <= current_date
    and (
      d >= date_trunc('month', current_date)::date
      or (
        d >= (date_trunc('month', current_date) - interval '1 month')::date
        and d <  date_trunc('month', current_date)::date
        and extract(day from current_date) <= 5
      )
    );
$function$;

-- 2. An employee may set 'present' directly ONLY for today. Any past-dated
--    move to Present must go through attendance_change_requests and be
--    approved by an Admin. Marking 'absent' is unchanged.
--    Admins are unaffected: policy att_admin still grants ALL.
drop policy if exists att_own_insert on public.attendance;
create policy att_own_insert on public.attendance
  for insert with check (
    employee_id = public.current_employee_id()
    and status = any (array['present','absent'])
    and public.employee_may_mark(date)
    and (status = 'absent' or date = current_date)
  );

drop policy if exists att_own_update on public.attendance;
create policy att_own_update on public.attendance
  for update
  using (
    employee_id = public.current_employee_id()
    and public.employee_may_mark(date)
  )
  with check (
    employee_id = public.current_employee_id()
    and status = any (array['present','absent'])
    and public.employee_may_mark(date)
    and (status = 'absent' or date = current_date)
  );
