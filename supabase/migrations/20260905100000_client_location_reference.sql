-- Optional reference to which of a client's sites an expense or an outdoor
-- visit relates to. Both are nullable and additive; existing rows are
-- unaffected and naming a client stays optional.
--
-- outdoor_visits.location is unchanged: that remains the free-text visit
-- location the employee types. client_location_id is a separate reference
-- used when the named client operates from more than one site.
--
-- ON DELETE SET NULL so removing a client location never destroys an
-- expense or visit record.
alter table public.company_expenses
  add column if not exists client_location_id uuid
  references public.client_locations(id) on delete set null;

alter table public.outdoor_visits
  add column if not exists client_location_id uuid
  references public.client_locations(id) on delete set null;
