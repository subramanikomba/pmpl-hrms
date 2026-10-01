-- Deactivation must remove access, not just hide the UI.
--
-- Every RLS policy resolves the caller through these two functions, so
-- neither checked status: a deactivated employee whose login still existed
-- could obtain a token and read their data by calling the API directly, and
-- a deactivated ADMIN would have kept full admin rights to payroll and
-- salary data. The browser signed them out, but the database did not.
--
-- Adding the status check here closes it everywhere at once — no policy
-- needs editing, because they all route through these.
create or replace function public.current_employee_id()
returns uuid
language sql
stable security definer
as $function$
  select id from public.employees
  where auth_user_id = auth.uid() and status = 'active'
  limit 1;
$function$;

create or replace function public.current_is_admin()
returns boolean
language sql
stable security definer
as $function$
  select coalesce(
    (select is_admin from public.employees
      where auth_user_id = auth.uid() and status = 'active'
      limit 1),
    false
  );
$function$;
