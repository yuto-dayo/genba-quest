-- M-4: Add a separate expense_lifecycle_state column for the new state
-- machine, leaving the existing review_status column intact.
--
-- Why a separate column instead of extending review_status?
-- The existing review_status enum ('not_required' | 'pending' | 'approved'
-- | 'rejected') drives the legacy "high-risk review" flow that triggers
-- Proposal-based approvals. The new states (captured / classified /
-- verified / posted / closed) describe a different axis: the lifecycle of
-- the expense itself from receipt capture to month close. The two run in
-- parallel for now and may merge in a later phase, but coupling them today
-- would force changes to the existing review-required code path.
--
-- Default: existing rows are backfilled to the closest equivalent — rows
-- already posted to the ledger are 'posted', everything else is 'captured'.
--
-- Related: docs/MONEY_EXPENSE_FLOW.md §2.2, §3, §11.2 / Gap analysis §4.3

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS expense_lifecycle_state text
    NOT NULL
    DEFAULT 'captured';

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_expense_lifecycle_state_check
  CHECK (
    expense_lifecycle_state = ANY (ARRAY[
      'captured',
      'classified',
      'verified',
      'posted',
      'closed'
    ])
  ) NOT VALID;

-- Backfill: rows already posted to the ledger should reflect that.
-- 'posted' is the existing transaction status meaning the journal entry
-- has been written.
UPDATE public.accounting_transactions
SET expense_lifecycle_state = 'posted'
WHERE kind = 'expense'
  AND status = 'posted'
  AND expense_lifecycle_state = 'captured';

ALTER TABLE public.accounting_transactions
  VALIDATE CONSTRAINT accounting_transactions_expense_lifecycle_state_check;

CREATE INDEX IF NOT EXISTS accounting_transactions_expense_lifecycle_state_idx
  ON public.accounting_transactions (org_id, kind, expense_lifecycle_state)
  WHERE kind = 'expense';

COMMENT ON COLUMN public.accounting_transactions.expense_lifecycle_state
  IS '経費ライフサイクル: captured(登録) → classified(現場決め済み) → verified(確認済み) → posted(帳簿入り) → closed(月締め). docs/MONEY_EXPENSE_FLOW.md §11.2';
