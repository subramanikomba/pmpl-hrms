-- Outdoor / site visit records. Purely a record of WHERE and WHEN an employee
-- was on site and whether a night stay was involved, so allowance rules
-- (outdoor_overnight, outdoor_day) can be given real quantities.
-- Deliberately carries no money: reimbursement stays in company_expenses.
create table if not exists public.outdoor_visits (
  id           uuid primary key default extensions.uuid_generate_v4(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  start_time   time,
  end_time     time,
  client_id    uuid references public.client_companies(id) on delete set null,
  location     text,
  purpose      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ov_date_order check (end_date >= start_date),
  constraint ov_span_sane check (end_date - start_date <= 60),
  nights       integer generated always as (end_date - start_date) stored,
  day_count    integer generated always as (end_date - start_date + 1) stored,
  is_overnight boolean generated always as (end_date > start_date) stored,
  is_multiday  boolean generated always as (end_date > start_date) stored
);

create index if not exists ov_emp_start_idx
  on public.outdoor_visits (employee_id, start_date desc);
create index if not exists ov_start_idx on public.outdoor_visits (start_date);

alter table public.outdoor_visits enable row level security;

drop policy if exists ov_admin on public.outdoor_visits;
create policy ov_admin on public.outdoor_visits
  for all using (public.current_is_admin());

drop policy if exists ov_own_read on public.outdoor_visits;
create policy ov_own_read on public.outdoor_visits
  for select using (employee_id = public.current_employee_id());

-- Employees may only add or change a visit while that period is still open
-- for editing — the same window that governs attendance. Once the period
-- closes the record is frozen for payroll/bonus purposes.
drop policy if exists ov_own_insert on public.outdoor_visits;
create policy ov_own_insert on public.outdoor_visits
  for insert with check (
    employee_id = public.current_employee_id()
    and public.employee_may_mark(start_date)
  );

drop policy if exists ov_own_update on public.outdoor_visits;
create policy ov_own_update on public.outdoor_visits
  for update
  using (employee_id = public.current_employee_id()
         and public.employee_may_mark(start_date))
  with check (employee_id = public.current_employee_id()
              and public.employee_may_mark(start_date));

drop policy if exists ov_own_delete on public.outdoor_visits;
create policy ov_own_delete on public.outdoor_visits
  for delete using (employee_id = public.current_employee_id()
                    and public.employee_may_mark(start_date));
