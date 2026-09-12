-- The employee code is the company-facing identifier shown on salary slips,
-- reports, dropdowns and ZIP filenames, so it must always exist. Held back
-- until every employee had been given their historical register number;
-- applied once all eight rows were populated.
--
-- The assign_employee_code trigger still supplies a code when none is given,
-- so this cannot block employee creation.
alter table public.employees
  alter column employee_code set not null;

-- Guard against a blank string, which NOT NULL alone would allow.
alter table public.employees
  drop constraint if exists employees_code_nonblank_chk;
alter table public.employees
  add constraint employees_code_nonblank_chk
  check (btrim(employee_code) <> '');
