-- Reserved days off ("comp-off"), recorded on the attendance row itself.
--
-- Two decisions, both made by Admin at payroll time:
--   1. A worked Sunday/holiday either pays the weekend bonus (the default,
--      which is today's behaviour) or is RESERVED as a day off.
--   2. An absence may be settled against a day reserved earlier — in the same
--      month or any earlier month.
--
-- Nothing is ever clawed back: a day can only be reserved while its own
-- month's payroll is still unpaid, so a bonus that has been paid out stays
-- paid. A reserved day never expires.
--
-- No new table. The link is one column on the absence row, which means the
-- existing trg_attendance_audit trigger records every change for free.

begin;

-- ── 1. New attendance status ──────────────────────────────────────
-- comp_off is a PAID day. It is deliberately neither 'present' (the employee
-- did not work) nor 'paid_leave' (which would wrongly disqualify the 100%
-- Attendance Bonus, since the employee worked a full month's days — just
-- shifted one of them).
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check
  check (status in ('present','paid_leave','unpaid_leave','weekly_off',
                    'company_holiday','absent','comp_off'));

-- ── 2. The two new columns ────────────────────────────────────────
-- On a worked Sunday/holiday: what Admin chose to do with it.
-- NULL means 'bonus', so every existing row keeps today's behaviour.
alter table public.attendance
  add column if not exists off_day_use text
  check (off_day_use in ('bonus','reserved'));

-- On a comp_off day: which reserved day it is settled against.
alter table public.attendance
  add column if not exists comp_off_against date;

comment on column public.attendance.off_day_use is
  'Worked Sunday/holiday only. NULL or bonus = pays the weekend bonus; '
  'reserved = withheld from the bonus and available as a day off.';
comment on column public.attendance.comp_off_against is
  'comp_off days only. The worked date this day off is settled against.';

-- ── 3. A reserved day can be spent exactly once ───────────────────
-- This is the guard against double-claiming, enforced by Postgres rather
-- than by application code.
create unique index if not exists attendance_comp_off_against_uniq
  on public.attendance (employee_id, comp_off_against)
  where comp_off_against is not null;

-- ── 4. Integrity rules ────────────────────────────────────────────
create or replace function public.validate_comp_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src record;
  paid_month boolean;
  work_days int[];
begin
  -- Only Admin may set either column. Employees can mark themselves present
  -- or absent (att_own_update), and must not be able to grant themselves a
  -- reserved day or settle their own absence.
  if (new.off_day_use is distinct from coalesce(old.off_day_use, null)
      or new.comp_off_against is distinct from coalesce(old.comp_off_against, null))
     and not current_is_admin() then
    raise exception 'Only an administrator may reserve or settle a day off';
  end if;

  -- ---- the worked day being reserved ----
  if new.off_day_use = 'reserved' then
    if new.status <> 'present' then
      raise exception 'Only a day marked Present can be reserved as a day off';
    end if;
    -- Must actually be a non-working day OR a company holiday — the same two
    -- cases computePaidDays counts as workedWeeklyOffs and workedHolidays.
    -- Working days come from company_settings so this rule can never drift
    -- from payroll's; Mon-Sat is the fallback, matching the app's default.
    select coalesce(
      (select s.working_days from public.company_settings s limit 1),
      array[1,2,3,4,5,6]
    ) into work_days;

    if (extract(dow from new.date)::int = any (work_days))
       and not exists (select 1 from public.company_holidays h
                       where h.holiday_date = new.date) then
      raise exception
        'Only a weekly off or a company holiday can be reserved as a day off';
    end if;
    -- The bonus for a paid month has already gone out, so that month is shut.
    select exists (
      select 1 from public.payroll p
      where p.employee_id = new.employee_id
        and p.payroll_month = date_trunc('month', new.date)::date
        and p.status = 'paid'
    ) into paid_month;
    if paid_month then
      raise exception 'Payroll for % is already paid, so this day cannot be reserved',
        to_char(new.date, 'Mon YYYY');
    end if;
  end if;

  -- Cannot un-reserve a day that has already been settled against.
  if tg_op = 'UPDATE' and old.off_day_use = 'reserved'
     and new.off_day_use is distinct from 'reserved'
     and exists (select 1 from public.attendance a
                 where a.employee_id = old.employee_id
                   and a.comp_off_against = old.date) then
    raise exception 'This reserved day is already used for a day off; undo that first';
  end if;

  -- ---- the absence being settled ----
  if new.comp_off_against is not null then
    if new.status <> 'comp_off' then
      raise exception 'Only a comp_off day may be settled against a reserved day';
    end if;
    select * into src from public.attendance a
      where a.employee_id = new.employee_id and a.date = new.comp_off_against;
    if not found then
      raise exception 'No attendance record for the reserved day %', new.comp_off_against;
    end if;
    if src.status <> 'present' or src.off_day_use is distinct from 'reserved' then
      raise exception '% is not a reserved day off', new.comp_off_against;
    end if;
    -- A reserved day may pay for an absence in its own month or a later one,
    -- never an earlier one — that would reach back into a closed payroll.
    if date_trunc('month', new.comp_off_against) > date_trunc('month', new.date) then
      raise exception 'A day reserved in % cannot settle an absence in %',
        to_char(new.comp_off_against, 'Mon YYYY'), to_char(new.date, 'Mon YYYY');
    end if;
    -- The absence's own month must still be open.
    select exists (
      select 1 from public.payroll p
      where p.employee_id = new.employee_id
        and p.payroll_month = date_trunc('month', new.date)::date
        and p.status = 'paid'
    ) into paid_month;
    if paid_month then
      raise exception 'Payroll for % is already paid', to_char(new.date, 'Mon YYYY');
    end if;
  end if;

  -- A comp_off day must say what it is settled against.
  if new.status = 'comp_off' and new.comp_off_against is null then
    raise exception 'A comp_off day must name the reserved day it settles';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_comp_off() from public, anon;

drop trigger if exists trg_validate_comp_off on public.attendance;
create trigger trg_validate_comp_off
  before insert or update on public.attendance
  for each row execute function public.validate_comp_off();

commit;
