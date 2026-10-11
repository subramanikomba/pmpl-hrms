-- Close a hole in ce_own_insert.
--
-- The policy checked only WHO the claim belongs to, never WHAT state it is
-- created in. The app has always inserted status='pending', so nothing in
-- the product exercised the gap — but an employee calling the API directly
-- could insert their own claim already marked approved, and it would flow
-- straight into Awaiting settlement and be reimbursed without review.
--
-- Verified against the live database before writing this: as EMP102, an
-- insert of status='approved' with reviewed_by set was ALLOWED.
--
-- After this, a non-admin may only create a pending, unreviewed, unaccounted
-- claim. An admin is unaffected, so recording their own expense as approved
-- still works.

alter policy ce_own_insert on public.company_expenses
  with check (
    employee_id = current_employee_id()
    and (
      current_is_admin()
      or (
        status = 'pending'
        and reviewed_by is null
        and reviewed_at is null
        and review_note is null
        and accounted_advance_id is null
        and accounted_amount is null
      )
    )
  );
