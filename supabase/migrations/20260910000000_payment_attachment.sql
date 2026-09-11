-- Optional proof-of-payment file (bank transfer screenshot / receipt) attached
-- to an existing payroll payment record. Only the storage object path is kept
-- in the database — never the bytes.
alter table public.payroll
  add column if not exists payment_attachment_url text,
  -- Admin decides, per payment, whether the employee may see the file.
  -- Default false: Admin-only unless explicitly shared.
  add column if not exists payment_attachment_shared boolean not null default false;

insert into storage.buckets (id, name, public)
values ('payment-attachments', 'payment-attachments', false)
on conflict (id) do nothing;

-- Path convention: {employee_id}/{payroll_id}.{ext}
drop policy if exists payatt_write_admin on storage.objects;
create policy payatt_write_admin on storage.objects
  for insert with check (
    bucket_id = 'payment-attachments' and public.current_is_admin());

drop policy if exists payatt_update_admin on storage.objects;
create policy payatt_update_admin on storage.objects
  for update using (
    bucket_id = 'payment-attachments' and public.current_is_admin());

drop policy if exists payatt_delete_admin on storage.objects;
create policy payatt_delete_admin on storage.objects
  for delete using (
    bucket_id = 'payment-attachments' and public.current_is_admin());

-- An employee may read their own attachment ONLY when Admin shared that
-- specific payment. Enforced here, not merely hidden in the UI.
drop policy if exists payatt_read_admin_or_shared on storage.objects;
create policy payatt_read_admin_or_shared on storage.objects
  for select using (
    bucket_id = 'payment-attachments'
    and (
      public.current_is_admin()
      or (
        (storage.foldername(name))[1] = (public.current_employee_id())::text
        and exists (
          select 1 from public.payroll p
          where p.employee_id = public.current_employee_id()
            and p.payment_attachment_url = storage.objects.name
            and p.payment_attachment_shared
        )
      )
    )
  );
