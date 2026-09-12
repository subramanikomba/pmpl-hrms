-- Fix: the previous version resolved new.reimbursement_id inside a CASE
-- expression. PL/pgSQL resolves record fields at runtime, so the field was
-- looked up even when the trigger fired on public.reimbursements, which has
-- no such column — failing every payment with
--   record "new" has no field "reimbursement_id".
--
-- IF blocks only execute the branch that applies, so each field is referenced
-- solely on the table that actually has it. Behaviour is otherwise unchanged.
create or replace function public.assert_reimbursement_total()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r_id  uuid;
  hdr   numeric;
  items numeric;
begin
  if tg_table_name = 'reimbursements' then
    if tg_op = 'DELETE' then r_id := old.id; else r_id := new.id; end if;
  else
    if tg_op = 'DELETE' then
      r_id := old.reimbursement_id;
    else
      r_id := new.reimbursement_id;
    end if;
  end if;

  select amount into hdr from public.reimbursements where id = r_id;
  if not found then return null; end if;

  select coalesce(sum(amount), 0) into items
  from public.reimbursement_items where reimbursement_id = r_id;

  if hdr <> items then
    raise exception
      'Reimbursement total % does not match the sum of its claim lines (%).',
      hdr, items
      using errcode = 'check_violation';
  end if;
  return null;
end;
$function$;
