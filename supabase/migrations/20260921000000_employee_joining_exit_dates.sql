-- Joining and exit dates, for record purposes only.
--
-- Deliberately NOT used by payroll: paid days, proration, the attendance
-- bonus and the Attendance Not Marked detector all continue to work exactly
-- as they do today. Using these dates in any calculation is a separate,
-- explicitly approved change.
--
-- Both nullable, so every existing employee is unaffected.
alter table public.employees
  add column if not exists joining_date date,
  add column if not exists exit_date date;

-- An exit cannot precede the joining date.
alter table public.employees
  drop constraint if exists employees_exit_after_joining_chk;
alter table public.employees
  add constraint employees_exit_after_joining_chk check (
    joining_date is null or exit_date is null or exit_date >= joining_date
  );
