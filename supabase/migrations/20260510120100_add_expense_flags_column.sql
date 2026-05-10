-- M-2: Add a flags array column to accounting_transactions.
--
-- Each flag is a short machine code (e.g. 'missing_job', 'duplicate_suspected',
-- 'asset_candidate'); the UI maps them to 職人語 labels via the vocabulary
-- table in docs/MONEY_EXPENSE_FLOW.md §11.3.
--
-- We intentionally do NOT add a CHECK constraint enumerating allowed flag
-- values: the set evolves with new anomaly rules (Phase 1 ルールベース →
-- Phase 3 AI), and migrating CHECK each time is heavier than the value of
-- enforcement. The set of valid flags is documented and seeded in code.
--
-- A GIN index supports fast "where flags @> array['missing_job']" lookups
-- used by the bucket aggregation endpoint.
--
-- Related: docs/MONEY_EXPENSE_FLOW.md §2.3, §6, §11.3

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS flags text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS accounting_transactions_flags_gin_idx
  ON public.accounting_transactions
  USING GIN (flags);

COMMENT ON COLUMN public.accounting_transactions.flags
  IS 'Anomaly / risk flags (missing_job / missing_invoice_number / duplicate_suspected / asset_candidate / advance_stale / billable_candidate / allocation_pending / budget_overrun / out_of_pattern). UI labels: docs/MONEY_EXPENSE_FLOW.md §11.3';
