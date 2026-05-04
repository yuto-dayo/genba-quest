-- ============================================================
-- 049: Proposal execution and posting groups
-- ============================================================
-- 目的:
--   1) proposal と execution history を分離する
--   2) accounting fact の root として posting_groups を導入する
--   3) journal entry / line が posting_group / revenue_basis に辿れるようにする
-- メモ:
--   - reward_runs への FK は 051 で追加するため、この段階では reward_run_id は plain uuid
--   - accounting_transactions.transaction_id は互換期間のため残す
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposal_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_code text,
  error_message text,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (proposal_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS proposal_executions_org_proposal_started_idx
  ON public.proposal_executions (org_id, proposal_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_executions_succeeded_once
  ON public.proposal_executions (proposal_id)
  WHERE status = 'succeeded';

ALTER TABLE public.proposal_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read proposal_executions" ON public.proposal_executions;
DROP POLICY IF EXISTS "Insert proposal_executions" ON public.proposal_executions;
DROP POLICY IF EXISTS "Update proposal_executions" ON public.proposal_executions;

CREATE POLICY "Read proposal_executions"
ON public.proposal_executions
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert proposal_executions"
ON public.proposal_executions
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update proposal_executions"
ON public.proposal_executions
FOR UPDATE TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
)
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE TABLE IF NOT EXISTS public.posting_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  group_type text NOT NULL CHECK (group_type IN (
    'income_post',
    'income_reverse',
    'payout_post',
    'payout_reverse'
  )),
  proposal_execution_id uuid NOT NULL REFERENCES public.proposal_executions(id) ON DELETE RESTRICT,
  revenue_basis_id uuid REFERENCES public.revenue_basis(id) ON DELETE SET NULL,
  reward_run_id uuid,
  reverses_posting_group_id uuid REFERENCES public.posting_groups(id) ON DELETE RESTRICT,
  accounting_date date NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  currency text NOT NULL DEFAULT 'JPY',
  description text NOT NULL,
  CONSTRAINT posting_groups_anchor_check
    CHECK (
      (
        group_type IN ('income_post', 'income_reverse')
        AND revenue_basis_id IS NOT NULL
        AND reward_run_id IS NULL
      )
      OR (
        group_type IN ('payout_post', 'payout_reverse')
        AND reward_run_id IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS posting_groups_org_type_posted_idx
  ON public.posting_groups (org_id, group_type, posted_at DESC);

CREATE INDEX IF NOT EXISTS posting_groups_proposal_execution_idx
  ON public.posting_groups (proposal_execution_id);

CREATE INDEX IF NOT EXISTS posting_groups_revenue_basis_idx
  ON public.posting_groups (revenue_basis_id)
  WHERE revenue_basis_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS posting_groups_reward_run_idx
  ON public.posting_groups (reward_run_id)
  WHERE reward_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS posting_groups_reversal_once
  ON public.posting_groups (reverses_posting_group_id)
  WHERE reverses_posting_group_id IS NOT NULL;

ALTER TABLE public.posting_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read posting_groups" ON public.posting_groups;
DROP POLICY IF EXISTS "Insert posting_groups" ON public.posting_groups;

CREATE POLICY "Read posting_groups"
ON public.posting_groups
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert posting_groups"
ON public.posting_groups
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

ALTER TABLE public.accounting_journal_entries
  ADD COLUMN IF NOT EXISTS posting_group_id uuid REFERENCES public.posting_groups(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS accounting_journal_entries_posting_group_idx
  ON public.accounting_journal_entries (posting_group_id)
  WHERE posting_group_id IS NOT NULL;

ALTER TABLE public.accounting_journal_lines
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_basis_id uuid REFERENCES public.revenue_basis(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counterparty_id uuid;

CREATE INDEX IF NOT EXISTS accounting_journal_lines_site_idx
  ON public.accounting_journal_lines (site_id)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS accounting_journal_lines_revenue_basis_idx
  ON public.accounting_journal_lines (revenue_basis_id)
  WHERE revenue_basis_id IS NOT NULL;

COMMENT ON TABLE public.proposal_executions IS
  'Execution history for proposals. Proposal state and execution attempts are tracked separately.';

COMMENT ON TABLE public.posting_groups IS
  'Accounting fact root. Journal entries must trace to posting_group -> proposal_execution.';

COMMENT ON COLUMN public.posting_groups.reward_run_id IS
  'Canonical reward run anchor. Foreign key is added in a later migration after reward_runs exists.';

COMMENT ON COLUMN public.accounting_journal_entries.posting_group_id IS
  'First-class accounting fact root. transaction_id remains only for compatibility during migration.';
