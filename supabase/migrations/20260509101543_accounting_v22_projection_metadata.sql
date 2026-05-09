-- Accounting v2.2 transition metadata and expense payload compatibility.
--
-- Additive only: existing accounting_transactions rows remain valid while
-- Money writes move from legacy direct rows toward transition lineage and,
-- later, canonical posting projections.

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS projection_source text,
  ADD COLUMN IF NOT EXISTS proposal_id uuid,
  ADD COLUMN IF NOT EXISTS proposal_execution_id uuid,
  ADD COLUMN IF NOT EXISTS posting_group_id uuid,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS legacy_source_route text,
  ADD COLUMN IF NOT EXISTS legacy_source_id text,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expense_scope text,
  ADD COLUMN IF NOT EXISTS paid_by text,
  ADD COLUMN IF NOT EXISTS claimant_member_id uuid,
  ADD COLUMN IF NOT EXISTS settlement_type text,
  ADD COLUMN IF NOT EXISTS payment_account text,
  ADD COLUMN IF NOT EXISTS reimbursement_status text,
  ADD COLUMN IF NOT EXISTS recurring_template_id uuid;

UPDATE public.accounting_transactions
SET projection_source = 'legacy_direct_write'
WHERE projection_source IS NULL;

ALTER TABLE public.accounting_transactions
  ALTER COLUMN projection_source SET DEFAULT 'legacy_direct_write';

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_projection_source_check
  CHECK (
    projection_source IS NULL
    OR projection_source = ANY (ARRAY[
      'legacy_direct_write',
      'transition_lineage',
      'canonical_posting_projection',
      'synthetic_backfill'
    ])
  ) NOT VALID;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_expense_scope_check
  CHECK (
    expense_scope IS NULL
    OR expense_scope = ANY (ARRAY['job', 'overhead'])
  ) NOT VALID;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_paid_by_check
  CHECK (
    paid_by IS NULL
    OR paid_by = ANY (ARRAY['org', 'member'])
  ) NOT VALID;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_member_claimant_required
  CHECK (
    paid_by IS DISTINCT FROM 'member'
    OR claimant_member_id IS NOT NULL
  ) NOT VALID;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_settlement_type_check
  CHECK (
    settlement_type IS NULL
    OR settlement_type = ANY (ARRAY['paid', 'unpaid'])
  ) NOT VALID;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_payment_account_check
  CHECK (
    payment_account IS NULL
    OR payment_account = ANY (ARRAY['cash', 'bank'])
  ) NOT VALID;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_reimbursement_status_check
  CHECK (
    reimbursement_status IS NULL
    OR reimbursement_status = ANY (ARRAY[
      'unsubmitted',
      'submitted',
      'approved',
      'reimbursed'
    ])
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS accounting_transactions_projection_source_idx
  ON public.accounting_transactions (org_id, projection_source, recorded_date);

CREATE INDEX IF NOT EXISTS accounting_transactions_proposal_idx
  ON public.accounting_transactions (org_id, proposal_id)
  WHERE proposal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS accounting_transactions_posting_group_idx
  ON public.accounting_transactions (org_id, posting_group_id)
  WHERE posting_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS accounting_transactions_expense_scope_idx
  ON public.accounting_transactions (org_id, expense_scope, paid_by)
  WHERE kind = 'expense';

COMMENT ON COLUMN public.accounting_transactions.projection_source
  IS 'v2.2 source mode for the compatibility projection row.';
COMMENT ON COLUMN public.accounting_transactions.metadata_json
  IS 'v2.2 transition metadata for compatibility projection rows.';
COMMENT ON COLUMN public.accounting_transactions.expense_scope
  IS 'v2.2 expense dimension: job direct cost or overhead/common cost.';
COMMENT ON COLUMN public.accounting_transactions.paid_by
  IS 'v2.2 expense settlement dimension: org-paid or member-paid reimbursement.';
