-- Final outdoor-visit rules.
--
--   Day visit:       day_count = end - start + 1, nights = 0. Same-day valid.
--   Overnight visit: day_count = end - start + 1, nights = end - start.
--                    end_date must be later than start_date.
--
-- The old model treated an overnight visit as exactly one night, required an
-- evening departure / morning return, and forced a visit to sit inside one
-- calendar month. All three are removed. A visit's payroll month is now the
-- month of its END date, handled in application code.
--
-- The table was empty when this ran, so there is no backfill.

alter table public.outdoor_visits drop column if exists nights;
alter table public.outdoor_visits drop column if exists day_count;
alter table public.outdoor_visits drop column if exists is_overnight;

alter table public.outdoor_visits
  drop constraint if exists ov_overnight_shape_chk,
  drop constraint if exists ov_day_shape_chk,
  drop constraint if exists ov_same_month_chk;

alter table public.outdoor_visits
  add constraint ov_overnight_shape_chk check (
    visit_type <> 'overnight' or end_date > start_date
  ),
  add constraint ov_day_shape_chk check (
    visit_type <> 'day' or end_date > start_date or end_time > start_time
  );

alter table public.outdoor_visits
  add column day_count integer generated always as (
    (end_date - start_date) + 1
  ) stored,
  add column nights integer generated always as (
    case when visit_type = 'overnight' then (end_date - start_date) else 0 end
  ) stored,
  add column is_overnight boolean generated always as (
    visit_type = 'overnight'
  ) stored;

-- ov_span_sane (60-day cap) and ov_date_order are deliberately retained.
