-- The employee payment summary must distinguish Payable / Overdue / Paid.
-- That requires the employee to see their own payroll once it is FINALISED,
-- not only once it is paid. Draft payroll stays invisible to employees.
drop policy if exists pay_own_read on public.payroll;
create policy pay_own_read on public.payroll
  for select using (
    employee_id = public.current_employee_id()
    and status in ('processed','paid')
  );
