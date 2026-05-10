-- M-1: Expand expense_scope CHECK constraint from 2 values to 4.
--
-- Existing scope set: 'job' | 'overhead' (2 values).
-- New set: 'job' | 'job_advance' | 'stockpile' | 'overhead' (4 values).
--
-- 'job_advance' = expense for a future / not-yet-started 現場 (先行仕入れ).
-- 'stockpile'   = shared consumables not tied to a single 現場 (共通在庫).
--
-- This is purely additive — every existing row still satisfies the new
-- constraint because old values 'job' and 'overhead' are still permitted.
-- The route layer (server/src/routes/accounting.ts) validates which scope
-- requires a site_id and which cost_center is allowed.
--
-- Related: docs/MONEY_EXPENSE_FLOW.md §2.1, §11.1

ALTER TABLE public.accounting_transactions
  DROP CONSTRAINT IF EXISTS accounting_transactions_expense_scope_check;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_expense_scope_check
  CHECK (
    expense_scope IS NULL
    OR expense_scope = ANY (ARRAY['job', 'job_advance', 'stockpile', 'overhead'])
  ) NOT VALID;

-- Mark the constraint as VALID after confirming no existing row violates it.
-- Existing rows only contain 'job' or 'overhead' (or NULL) so this is safe.
ALTER TABLE public.accounting_transactions
  VALIDATE CONSTRAINT accounting_transactions_expense_scope_check;

COMMENT ON CONSTRAINT accounting_transactions_expense_scope_check
  ON public.accounting_transactions
  IS '紐付け先 4値: job(現場) / job_advance(先行仕入れ) / stockpile(共通在庫) / overhead(本部)';
