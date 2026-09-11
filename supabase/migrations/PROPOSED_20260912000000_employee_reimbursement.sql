-- ============================================================
-- PROPOSED — NOT YET APPLIED. For review.
--
-- Employee Expense Reimbursement + Payment Vouchers.
--
-- Reimbursement is its own transaction type. It is deliberately kept OUT of
-- company_advance_ledger: a reimbursement is the company paying an employee
-- back for money they already spent, not company money the employee holds.
-- The advance ledger, its running_balance and all existing advance accounting
-- are untouched by this migration.
--
-- Nothing here touches payroll, attendance, leave or salary.
-- ============================================================

-- ── 1. Voucher numbering ────────────────────────────────────
-- Numbers are issued in Postgres, never in the client: two admins recording
-- payments at the same moment must not receive the same voucher number.
create table if not exists public.voucher_sequences (
  prefix       text    not null,
  year         integer not null,
  last_number  integer not null default 0,
  primary key (prefix, year)
);

alter table public.voucher_sequences enable row level security;
-- No policy: only SECURITY DEFINER code below may touch it.

/**
 * Issue the next voucher number for a prefix and year, e.g. RV-2026-0001.
 * The INSERT ... ON CONFLICT DO UPDATE takes a row lock, so concurrent
 * callers serialise and can never be handed the same number.
 */
create or replace function public.next_voucher_no(p_prefix text, p_year integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  if p_prefix not in ('RV', 'AV') then
    raise exception 'Unknown voucher prefix: %', p_prefix;
  end if;

  insert into public.voucher_sequences (prefix, year, last_number)
  values (p_prefix, p_year, 1)
  on conflict (prefix, year)
    do update set last_number = public.voucher_sequences.last_number + 1
  returning last_number into n;

  return p_prefix || '-' || p_year::text || '-' || lpad(n::text, 4, '0');
end;
$function$;

revoke all on function public.next_voucher_no(text, integer) from public;
grant execute on function public.next_voucher_no(text, integer) to authenticated;


-- ── 2. Reimbursement payments ───────────────────────────────
-- One row per actual payment made to an employee. The payment date is the
-- date money moved and is independent of the expense month: an August expense
-- may be reimbursed in September without altering the expense.
create table if not exists public.reimbursements (
  id                 uuid primary key default extensions.uuid_generate_v4(),
  employee_id        uuid not null references public.employees(id),
  voucher_no         text not null unique,
  payment_date       date not null,
  amount             numeric(12,2) not null,
  payment_mode       text not null,
  reference          text,
  notes              text,
  -- Proof of payment. Storage object path only, never the bytes — the same
  -- pattern as payroll payment attachments.
  attachment_url     text,
  attachment_shared  boolean not null default false,
  paid_by            uuid references public.employees(id),
  created_at         timestamptz not null default now(),
  constraint reimb_amount_positive check (amount > 0)
);

create index if not exists reimb_emp_date_idx
  on public.reimbursements (employee_id, payment_date desc);


-- ── 3. What each payment settled ────────────────────────────
-- The per-claim split. This is the ONLY record of how much a claim has been
-- reimbursed: there is deliberately no cumulative "reimbursed_amount" column
-- on company_expenses for an Admin to edit. Totals are always derived by
-- summing these immutable transaction rows, so the audit trail cannot drift
-- from the balance.
create table if not exists public.reimbursement_items (
  id                uuid primary key default extensions.uuid_generate_v4(),
  reimbursement_id  uuid not null references public.reimbursements(id) on delete cascade,
  expense_id        uuid not null references public.company_expenses(id),
  amount            numeric(12,2) not null,
  constraint reimb_item_amount_positive check (amount > 0),
  -- One line per claim per payment; a claim is settled across payments by
  -- having several items, one per reimbursement.
  constraint reimb_item_unique unique (reimbursement_id, expense_id)
);

create index if not exists reimb_item_expense_idx
  on public.reimbursement_items (expense_id);


-- ── 4. Eligibility and over-payment guard ───────────────────
/**
 * Total already reimbursed against one claim. SECURITY DEFINER so the guard
 * below sees every payment, including any recorded by another admin.
 */
create or replace function public.expense_reimbursed_total(p_expense_id uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(sum(amount), 0)
  from public.reimbursement_items
  where expense_id = p_expense_id;
$function$;

/**
 * Refuse any item that would take a claim past its approved amount, and
 * refuse claims that are not reimbursable at all.
 *
 * A CHECK constraint cannot span tables, so this is enforced by trigger. The
 * claim row is locked FOR UPDATE first, so two concurrent payments against
 * the same claim cannot both pass the test and jointly over-reimburse.
 */
create or replace function public.guard_reimbursement_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  claim   public.company_expenses%rowtype;
  already numeric;
begin
  select * into claim
  from public.company_expenses
  where id = new.expense_id
  for update;                        -- serialise concurrent payments

  if not found then
    raise exception 'Expense claim not found.';
  end if;

  if claim.status <> 'approved' then
    raise exception 'Only approved expense claims can be reimbursed.'
      using errcode = 'check_violation';
  end if;

  -- Already funded by a company advance the employee was holding.
  -- Reimbursing it again would pay for the same expense twice.
  if claim.accounted_advance_id is not null then
    raise exception
      'This claim is accounted against a company advance and cannot be reimbursed.'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0) into already
  from public.reimbursement_items
  where expense_id = new.expense_id
    and id is distinct from new.id;   -- exclude this row on UPDATE

  if already + new.amount > claim.amount then
    raise exception
      'Reimbursement of % exceeds the outstanding balance on this claim (approved %, already reimbursed %).',
      new.amount, claim.amount, already
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_reimbursement_item on public.reimbursement_items;
create trigger trg_guard_reimbursement_item
  before insert or update on public.reimbursement_items
  for each row execute function public.guard_reimbursement_item();


/**
 * The stored header amount must always equal the sum of its items.
 *
 * amount is the money that actually left the company in THIS transaction and
 * is never recalculated from a claim's approved amount later. This assertion
 * only guarantees the split adds up to it.
 *
 * DEFERRABLE INITIALLY DEFERRED: the header is inserted before its items, so
 * an immediate check would fire while the sum is still zero. Deferring runs
 * it once at COMMIT, when the whole payment is present.
 */
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
  r_id := coalesce(
    case when tg_table_name = 'reimbursements'
         then coalesce(new.id, old.id) end,
    case when tg_table_name = 'reimbursement_items'
         then coalesce(new.reimbursement_id, old.reimbursement_id) end
  );

  select amount into hdr from public.reimbursements where id = r_id;
  -- The payment was deleted in this transaction; nothing left to reconcile.
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

drop trigger if exists trg_assert_reimb_total_items on public.reimbursement_items;
create constraint trigger trg_assert_reimb_total_items
  after insert or update or delete on public.reimbursement_items
  deferrable initially deferred
  for each row execute function public.assert_reimbursement_total();

drop trigger if exists trg_assert_reimb_total_header on public.reimbursements;
create constraint trigger trg_assert_reimb_total_header
  after insert or update on public.reimbursements
  deferrable initially deferred
  for each row execute function public.assert_reimbursement_total();


-- ── 5. Derived status ───────────────────────────────────────
-- company_expenses.status keeps its existing three values (pending/approved/
-- rejected) and its CHECK constraint, so every existing query is unaffected.
-- Reimbursement status is derived here and never stored.
create or replace view public.expense_reimbursement_status as
select
  ce.id                                as expense_id,
  ce.employee_id,
  ce.expense_date,
  ce.category,
  ce.description,
  ce.amount                            as approved_amount,
  coalesce(ri.paid, 0)                 as reimbursed_amount,
  ce.amount - coalesce(ri.paid, 0)     as outstanding_amount,
  (ce.status = 'approved'
     and ce.accounted_advance_id is null
     and ce.amount - coalesce(ri.paid, 0) > 0)          as is_reimbursable,
  case
    when ce.status <> 'approved'                then ce.status
    when ce.accounted_advance_id is not null    then 'accounted_against_advance'
    when coalesce(ri.paid, 0) = 0               then 'pending_reimbursement'
    when coalesce(ri.paid, 0) < ce.amount       then 'partially_reimbursed'
    else                                             'reimbursed'
  end                                  as reimbursement_status
from public.company_expenses ce
left join (
  select expense_id, sum(amount) as paid
  from public.reimbursement_items
  group by expense_id
) ri on ri.expense_id = ce.id;


-- ── 6. Company advance voucher ──────────────────────────────
-- One nullable column. The advance table, the ledger view and all existing
-- advance accounting behaviour are otherwise untouched.
alter table public.company_advances
  add column if not exists voucher_no text;

create unique index if not exists company_advances_voucher_no_key
  on public.company_advances (voucher_no) where voucher_no is not null;


-- ── 7. Access ───────────────────────────────────────────────
alter table public.reimbursements enable row level security;
alter table public.reimbursement_items enable row level security;

-- Admin has full control of reimbursement payments.
drop policy if exists reimb_admin on public.reimbursements;
create policy reimb_admin on public.reimbursements
  for all using (public.current_is_admin());

-- An employee may read their own payments, and nobody else's.
drop policy if exists reimb_own_read on public.reimbursements;
create policy reimb_own_read on public.reimbursements
  for select using (employee_id = public.current_employee_id());

drop policy if exists reimb_item_admin on public.reimbursement_items;
create policy reimb_item_admin on public.reimbursement_items
  for all using (public.current_is_admin());

drop policy if exists reimb_item_own_read on public.reimbursement_items;
create policy reimb_item_own_read on public.reimbursement_items
  for select using (
    exists (
      select 1 from public.reimbursements r
      where r.id = reimbursement_items.reimbursement_id
        and r.employee_id = public.current_employee_id()
    )
  );


-- ── 8. Payment proof storage ────────────────────────────────
insert into storage.buckets (id, name, public)
values ('reimbursement-proofs', 'reimbursement-proofs', false)
on conflict (id) do nothing;

-- Path convention: {employee_id}/{reimbursement_id}.{ext}
drop policy if exists reimbproof_write_admin on storage.objects;
create policy reimbproof_write_admin on storage.objects
  for insert with check (
    bucket_id = 'reimbursement-proofs' and public.current_is_admin());

drop policy if exists reimbproof_update_admin on storage.objects;
create policy reimbproof_update_admin on storage.objects
  for update using (
    bucket_id = 'reimbursement-proofs' and public.current_is_admin());

drop policy if exists reimbproof_delete_admin on storage.objects;
create policy reimbproof_delete_admin on storage.objects
  for delete using (
    bucket_id = 'reimbursement-proofs' and public.current_is_admin());

-- The employee sees the proof only when Admin shared that payment.
drop policy if exists reimbproof_read_admin_or_shared on storage.objects;
create policy reimbproof_read_admin_or_shared on storage.objects
  for select using (
    bucket_id = 'reimbursement-proofs'
    and (
      public.current_is_admin()
      or (
        (storage.foldername(name))[1] = (public.current_employee_id())::text
        and exists (
          select 1 from public.reimbursements r
          where r.employee_id = public.current_employee_id()
            and r.attachment_url = storage.objects.name
            and r.attachment_shared
        )
      )
    )
  );
