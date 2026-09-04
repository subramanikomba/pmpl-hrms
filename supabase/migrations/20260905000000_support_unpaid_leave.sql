-- Admin may now approve a leave request as Paid or Unpaid.
-- Unpaid leave is a distinct attendance state: not Absent (the employee was
-- authorised to be away) but not a paid day either, so payroll excludes it
-- from paid days via computePaidDays.
alter table public.leave_requests
  drop constraint if exists leave_requests_leave_type_check;
alter table public.leave_requests
  add constraint leave_requests_leave_type_check
  check (leave_type in ('paid_leave','unpaid_leave'));

alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check
  check (status in ('present','paid_leave','unpaid_leave','weekly_off',
                    'company_holiday','absent'));
