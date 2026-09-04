-- End-of-day cutoff after which an unmarked attendance day is raised to Admin
-- as an "Attendance Not Marked" exception. Configurable, not hard-coded;
-- unmarked days are never auto-converted to Present or Absent.
alter table public.company_settings
  add column if not exists attendance_cutoff_time time not null default '19:00';
