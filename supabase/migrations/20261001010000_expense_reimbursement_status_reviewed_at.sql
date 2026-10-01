-- Expose the approval timestamp on the derived reimbursement-status view.
--
-- Settlement aging must run from the date the claim was APPROVED, not the date
-- the expense was incurred: before approval the company has not agreed it owes
-- anything, so counting earlier blames settlement for a slow approval. On live
-- data the two anchors differed by as much as 37 days.
--
-- The Employee Ledger already ages correctly, because it reads company_expenses
-- directly for the claim rows (it needs the full rows, not just the date, so it
-- keeps that query). The Reimbursements tab had only this view to work from and
-- so aged from expense_date, reporting a different age for the same claim.
-- Adding the column lets both screens use one anchor.
--
-- Purely additive: one column appended, every existing consumer selects * or
-- named columns that are unchanged. No table altered, no data modified, no
-- policy touched. reviewed_at is null for a claim that has not been reviewed.

create or replace view public.expense_reimbursement_status as
 SELECT ce.id AS expense_id,
    ce.employee_id,
    ce.expense_date,
    ce.category,
    ce.description,
    ce.amount AS approved_amount,
    COALESCE(ri.paid, 0::numeric) AS reimbursed_amount,
    ce.amount - COALESCE(ri.paid, 0::numeric) AS outstanding_amount,
    ce.status = 'approved'::text AND ce.accounted_advance_id IS NULL AND (ce.amount - COALESCE(ri.paid, 0::numeric)) > 0::numeric AS is_reimbursable,
        CASE
            WHEN ce.status <> 'approved'::text THEN ce.status
            WHEN ce.accounted_advance_id IS NOT NULL THEN 'accounted_against_advance'::text
            WHEN COALESCE(ri.paid, 0::numeric) = 0::numeric THEN 'pending_reimbursement'::text
            WHEN COALESCE(ri.paid, 0::numeric) < ce.amount THEN 'partially_reimbursed'::text
            ELSE 'reimbursed'::text
        END AS reimbursement_status,
    ce.reviewed_at
   FROM company_expenses ce
     LEFT JOIN ( SELECT reimbursement_items.expense_id,
            sum(reimbursement_items.amount) AS paid
           FROM reimbursement_items
          GROUP BY reimbursement_items.expense_id) ri ON ri.expense_id = ce.id;
