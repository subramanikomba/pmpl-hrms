-- Record a reimbursement payment and its claim lines in ONE transaction.
--
-- Why this exists: the client wrote the header and the lines as two separate
-- REST calls, which PostgREST runs as two separate transactions. The deferred
-- total assertion therefore fired at the end of the header's own transaction,
-- when no lines existed yet, and rejected every payment with
--   "Reimbursement total X does not match the sum of its claim lines (0)".
--
-- Doing both inside one function makes the whole payment atomic: the deferred
-- assertion runs once at the end with everything present, and a failure rolls
-- back the header too, so no orphan payment is left behind.
create or replace function public.record_reimbursement(
  p_employee_id   uuid,
  p_voucher_no    text,
  p_payment_date  date,
  p_payment_mode  text,
  p_reference     text,
  p_notes         text,
  p_paid_by       uuid,
  p_shared        boolean,
  p_lines         jsonb
)
returns public.reimbursements
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  total numeric;
  row   public.reimbursements;
begin
  if not public.current_is_admin() then
    raise exception 'Only admins can record reimbursements.'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum((l->>'amount')::numeric), 0) into total
  from jsonb_array_elements(p_lines) l;

  if total <= 0 then
    raise exception 'Enter an amount against at least one claim.'
      using errcode = 'check_violation';
  end if;

  insert into public.reimbursements (
    employee_id, voucher_no, payment_date, amount, payment_mode,
    reference, notes, attachment_shared, paid_by
  ) values (
    p_employee_id, p_voucher_no, p_payment_date, total, p_payment_mode,
    p_reference, p_notes, coalesce(p_shared, false), p_paid_by
  ) returning * into row;

  insert into public.reimbursement_items (reimbursement_id, expense_id, amount)
  select row.id, (l->>'expense_id')::uuid, (l->>'amount')::numeric
  from jsonb_array_elements(p_lines) l
  where (l->>'amount')::numeric > 0;

  return row;
end;
$function$;

revoke all on function public.record_reimbursement(
  uuid, text, date, text, text, text, uuid, boolean, jsonb) from public;
grant execute on function public.record_reimbursement(
  uuid, text, date, text, text, text, uuid, boolean, jsonb) to authenticated;
