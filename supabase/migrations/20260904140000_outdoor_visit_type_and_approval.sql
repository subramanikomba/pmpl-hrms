-- Outdoor visits gain an explicit category and an Admin approval decision.
alter table public.outdoor_visits drop column if exists nights;
alter table public.outdoor_visits drop column if exists day_count;
alter table public.outdoor_visits drop column if exists is_overnight;
alter table public.outdoor_visits drop column if exists is_multiday;

alter table public.outdoor_visits
  add column if not exists visit_type  text not null default 'day',
  add column if not exists status      text not null default 'pending',
  add column if not exists approved_by uuid references public.employees(id),
  add column if not exists approved_at timestamptz,
  add column if not exists review_note text;
alter table public.outdoor_visits alter column visit_type drop default;

-- Time and location distinguish a day visit from an overnight one, so an
-- incomplete visit must never reach the approval queue.
alter table public.outdoor_visits alter column start_time set not null;
alter table public.outdoor_visits alter column end_time   set not null;
alter table public.outdoor_visits alter column location   set not null;

alter table public.outdoor_visits
  drop constraint if exists ov_type_chk,
  drop constraint if exists ov_status_chk,
  drop constraint if exists ov_same_month_chk,
  drop constraint if exists ov_overnight_shape_chk,
  drop constraint if exists ov_day_shape_chk,
  drop constraint if exists ov_location_nonblank_chk;

alter table public.outdoor_visits
  add constraint ov_type_chk check (visit_type in ('day','overnight')),
  add constraint ov_status_chk check (status in ('pending','approved','rejected')),
  add constraint ov_location_nonblank_chk check (btrim(location) <> ''),
  add constraint ov_same_month_chk check (
    date_trunc('month', start_date) = date_trunc('month', end_date)),
  add constraint ov_overnight_shape_chk check (
    visit_type <> 'overnight' or (
      end_date = start_date + 1
      and start_time >= time '16:00' and end_time <= time '12:00')),
  add constraint ov_day_shape_chk check (
    visit_type <> 'day' or (
      (end_date > start_date or end_time > start_time)
      and not (end_date = start_date + 1
               and start_time >= time '16:00' and end_time <= time '12:00')));

alter table public.outdoor_visits
  add column nights integer generated always as (
    case when visit_type = 'overnight' then 1 else 0 end) stored,
  add column day_count integer generated always as (
    case when visit_type = 'day' then (end_date - start_date + 1) else 0 end) stored,
  add column is_overnight boolean generated always as (
    visit_type = 'overnight') stored;

create index if not exists ov_status_idx
  on public.outdoor_visits (status, start_date desc);

drop policy if exists ov_own_insert on public.outdoor_visits;
create policy ov_own_insert on public.outdoor_visits
  for insert with check (
    employee_id = public.current_employee_id()
    and public.employee_may_mark(start_date)
    and start_date <= current_date and end_date <= current_date
    and status = 'pending');

drop policy if exists ov_own_update on public.outdoor_visits;
create policy ov_own_update on public.outdoor_visits
  for update
  using (employee_id = public.current_employee_id() and status = 'pending'
         and public.employee_may_mark(start_date))
  with check (employee_id = public.current_employee_id() and status = 'pending'
              and public.employee_may_mark(start_date)
              and start_date <= current_date and end_date <= current_date);

drop policy if exists ov_own_delete on public.outdoor_visits;
create policy ov_own_delete on public.outdoor_visits
  for delete using (employee_id = public.current_employee_id()
                    and status = 'pending'
                    and public.employee_may_mark(start_date));
