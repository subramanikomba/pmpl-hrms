# Deferred to Phase 2

Items specified in the Phase 1 design specification that are **not implemented**
in the frozen Phase 1 build. Recorded here so they are a known decision rather
than a discovery.

## 1. Salary recovery from Company Advance — DEFERRED

**Status: not implemented. Deliberately held for Phase 2.**

The Phase 1 specification allows it in two places:

- §5 Company Advance — "Salary recovery against a Company Advance is permitted
  as an exceptional Admin action."
- §10 Reports — the employee ledger should show "every Company Advance,
  approved Company Expense **and exceptional Salary Recovery**."

Neither is built. Verified against the live database and the code:

- `company_advance_ledger` is a `UNION ALL` of exactly two branches —
  `company_advances` and accounted `company_expenses`. There is no recovery
  transaction type.
- There is no `company_advance_recoveries` table.
- `payroll` has one recovery column, `salary_advance_recovered`, which belongs
  to Salary Advance — a separate entity per §6.
- No payroll code references company advances.

**Not affected:** Salary Advance recovery through payroll is fully implemented
and is a different thing. Company Advance and Salary Advance remain separate
entities as §6 requires.

**Rough shape when picked up** (recommended, mirrors the salary-advance
pattern so the ledger stays the single source of truth):

1. `company_advance_recoveries` table — employee, advance, payroll month,
   amount, recorded-by, with RLS matching `company_advances`.
2. A third branch in the `company_advance_ledger` view emitting
   `txn_type = 'salary_recovery'` as a credit.
3. Widen `LedgerRow.txn_type` in `src/types/db.ts` from
   `'advance' | 'expense'` and add the badge case in `CompanyAdvancePage`.
4. An Admin-entered, capped recovery field in payroll, following
   `capRecovery` and `salaryAdvanceApi.syncRecovery` in this codebase.

The alternative — a plain column on `payroll` — is simpler but keeps the
recovery out of the ledger, which conflicts with §10.

## 2. Other known Phase 1 limitations

- **No component tests.** Business rules in `src/lib/` are covered; React
  components are not.
- **Baseline schema is not in `supabase/migrations/`.** Only changes made
  during this work are captured. The original tables, policies, functions and
  the ledger view were created outside migrations and must be recovered from
  the owner's original session or dumped from the live database before the
  project can be rebuilt from source.
- **`login-with-username` Edge Function** is stubbed to return 410 and is no
  longer referenced by the client, but is still deployed and should be deleted
  from the Supabase dashboard.
- **Monthly payroll grid** collapses Special / Transport / Medical /
  Conveyance into one "Allowances" column; §9 lists them individually. The
  individual values are stored and appear on the salary slip.
