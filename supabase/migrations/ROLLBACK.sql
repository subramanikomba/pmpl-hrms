-- Reverses both migrations, restoring the pre-change behaviour exactly.
drop policy if exists att_own_insert on public.attendance;
create policy att_own_insert on public.attendance
  for insert with check (
    employee_id = public.current_employee_id()
    and status = any (array['present','absent'])
    and public.employee_may_mark(date)
  );

drop policy if exists att_own_update on public.attendance;
create policy att_own_update on public.attendance
  for update
  using (employee_id = public.current_employee_id() and public.employee_may_mark(date))
  with check (
    employee_id = public.current_employee_id()
    and status = any (array['present','absent'])
    and public.employee_may_mark(date)
  );

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
        and current_date < (
          date_trunc('month', current_date)::date
          + ((select coalesce(max(salary_payment_day), 10) from public.company_settings) - 1)
        )
      )
    );
$function$;

drop table if exists public.attendance_change_requests;

-- ── v24 rollback ────────────────────────────────────────────────
drop policy if exists pay_own_read on public.payroll;
create policy pay_own_read on public.payroll
  for select using (
    employee_id = public.current_employee_id() and status = 'paid'
  );

drop table if exists public.outdoor_visits;
