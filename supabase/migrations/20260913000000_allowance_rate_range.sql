-- ============================================================
-- PROPOSED — NOT APPLIED. For review.
--
-- Records the agreed rate range for an allowance rule, so Admin can see in
-- Payroll Settings what range was agreed for that allowance.
--
-- REFERENCE ONLY. Payroll continues to calculate from rate_percent exactly as
-- it does today. Nothing reads these two columns outside the Settings screen:
-- no payroll calculation, no draft, no snapshot, no payment path.
--
-- Both columns are nullable with no default, so all five existing rules keep
-- working unchanged as fixed-rate rules. No payroll data is migrated or
-- touched, and paid and locked payroll are unaffected.
-- ============================================================
alter table public.allowance_rules
  add column if not exists min_rate_percent numeric(5,2),
  add column if not exists max_rate_percent numeric(5,2);

-- A half-configured range would be meaningless, and a max below a min would
-- be misleading. Deliberately does NOT constrain rate_percent against the
-- range: rate_percent drives payroll and must stay free of any new rule.
alter table public.allowance_rules
  drop constraint if exists allowance_rule_range_chk;
alter table public.allowance_rules
  add constraint allowance_rule_range_chk check (
    (min_rate_percent is null) = (max_rate_percent is null)
    and (
      min_rate_percent is null
      or (min_rate_percent > 0 and min_rate_percent <= max_rate_percent)
    )
  );
