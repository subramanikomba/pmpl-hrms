-- Past "change to Present" corrections require Admin approval.
-- Additive only: no existing table, column or policy is altered here.
create table if not exists public.attendance_change_requests (
  id            uuid primary key default extensions.uuid_generate_v4(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  date          date not null,
  from_status   text,
  to_status     text not null default 'present',
  reason        text,
  status        text not null default 'pending',
  reviewed_by   uuid references public.employees(id),
  review_note   text,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint acr_to_status_chk check (to_status = 'present'),
  constraint acr_status_chk check (status in ('pending','approved','rejected'))
);

create unique index if not exists acr_one_pending_per_day
  on public.attendance_change_requests (employee_id, date)
  where status = 'pending';

create index if not exists acr_status_idx
  on public.attendance_change_requests (status, date desc);

alter table public.attendance_change_requests enable row level security;

drop policy if exists acr_admin on public.attendance_change_requests;
create policy acr_admin on public.attendance_change_requests
  for all using (public.current_is_admin());

drop policy if exists acr_own_read on public.attendance_change_requests;
create policy acr_own_read on public.attendance_change_requests
  for select using (employee_id = public.current_employee_id());

drop policy if exists acr_own_insert on public.attendance_change_requests;
create policy acr_own_insert on public.attendance_change_requests
  for insert with check (
    employee_id = public.current_employee_id()
    and to_status = 'present'
    and date < current_date
    and public.employee_may_mark(date)
  );

drop policy if exists acr_own_delete on public.attendance_change_requests;
create policy acr_own_delete on public.attendance_change_requests
  for delete using (
    employee_id = public.current_employee_id() and status = 'pending'
  );
