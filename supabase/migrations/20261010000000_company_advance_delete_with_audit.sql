-- ============================================================
-- Company advance: guarded delete + audit
-- Run in Supabase → SQL Editor. Purely additive:
--   • creates ONE new table (company_advance_audit)
--   • creates ONE new function (delete_company_advance)
-- No existing table, policy, view or row is altered.
-- Safe to re-run (create ... if not exists / or replace).
-- ============================================================
--
-- Why this is needed: an advance entered by mistake (for example, a
-- reimbursement entered through the advance route) leaves the employee showing
-- custody of money they never held, and every summary keeps reporting it.
-- There was no way to remove one.
--
-- Why deletion rather than a negative reversal: company_advances.amount is
-- CHECK (amount > 0), so a reversal would mean weakening a constraint that
-- currently stops a typo creating a negative advance - and it would consume a
-- second AV voucher number for a payment that never happened.
--
-- Deletion alone would leave no trace, which is wrong for a money record when
-- attendance and payroll both have audit tables. Hence the pairing: the ledger
-- stays clean, the history survives here.

create table if not exists public.company_advance_audit (
  id           uuid primary key default gen_random_uuid(),
  advance_id   uuid,                       -- the deleted row's id; deliberately
                                           -- not an FK, the row is gone
  employee_id  uuid references public.employees(id),
  action       text not null,
  performed_by uuid references public.employees(id),
  note         text,
  snapshot     jsonb,                      -- the whole row as it was
  created_at   timestamptz not null default now()
);

comment on table public.company_advance_audit is
  'Deleted company advances. Written by delete_company_advance(); the snapshot holds the full row so a removed advance can always be explained.';

alter table public.company_advance_audit enable row level security;

-- Admin only, read and write. Employees have no business reading deletions.
drop policy if exists caa_admin on public.company_advance_audit;
create policy caa_admin on public.company_advance_audit
  for all using (public.current_is_admin());

/*
 * Audit and delete in ONE transaction, so a deletion can never happen without
 * its audit row. Two client calls would leave a window where the delete
 * succeeds and the audit insert fails, losing the trace exactly when it is
 * needed.
 */
create or replace function public.delete_company_advance(
  p_advance_id uuid,
  p_reason     text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row       public.company_advances%rowtype;
  v_accounted int;
  v_actor     uuid := public.current_employee_id();
begin
  if not public.current_is_admin() then
    raise exception 'Only an administrator can delete a company advance.';
  end if;

  select * into v_row from public.company_advances where id = p_advance_id;
  if not found then
    raise exception 'That company advance no longer exists.';
  end if;

  -- The foreign key would refuse this anyway; checking first turns a raw
  -- constraint error into something the Admin can act on. Reachable when the
  -- page is stale, or when the function is called outside our UI.
  select count(*) into v_accounted
  from public.company_expenses where accounted_advance_id = p_advance_id;

  if v_accounted > 0 then
    raise exception
      'Cannot delete: % expense claim(s) are accounted against this advance. Un-account them first.',
      v_accounted;
  end if;

  insert into public.company_advance_audit
    (advance_id, employee_id, action, performed_by, note, snapshot)
  values
    (v_row.id, v_row.employee_id, 'deleted', v_actor,
     nullif(btrim(coalesce(p_reason, '')), ''), to_jsonb(v_row));

  delete from public.company_advances where id = p_advance_id;
end;
$$;

revoke all on function public.delete_company_advance(uuid, text) from public;
grant execute on function public.delete_company_advance(uuid, text) to authenticated;

-- Verify: expect the table, the policy and the function to exist.
select 'table'    as object, count(*)::text as found from information_schema.tables
  where table_schema='public' and table_name='company_advance_audit'
union all
select 'policy',  count(*)::text from pg_policies
  where schemaname='public' and tablename='company_advance_audit'
union all
select 'function', count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='delete_company_advance';
