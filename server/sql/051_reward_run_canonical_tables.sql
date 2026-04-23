-- ============================================================
-- 051: Reward run canonical tables
-- ============================================================
-- 目的:
--   1) reward.calculate / reward.adjust の immutable output を canonical 化する
--   2) reward_run と payout posting の関係を DB 上で接続する
--   3) proposal / posting_groups の reward anchor FK を完成させる
-- メモ:
--   - reward_rule_version_id は現時点で参照先 table 未確定のため plain uuid のまま保持
--   - hard guard と fixed month mutation guard は後続 migration で行う
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reward_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  run_kind text NOT NULL CHECK (run_kind IN ('calculation', 'adjustment')),
  month_close_id uuid NOT NULL REFERENCES public.month_closes(id) ON DELETE RESTRICT,
  proposal_execution_id uuid NOT NULL REFERENCES public.proposal_executions(id) ON DELETE RESTRICT,
  reward_rule_version_id uuid NOT NULL,
  calculation_system text NOT NULL CHECK (calculation_system = 'path_v22'),
  adjusts_reward_run_id uuid REFERENCES public.reward_runs(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('fixed', 'superseded')),
  fixed_at timestamptz NOT NULL DEFAULT now(),
  payout_posting_group_id uuid REFERENCES public.posting_groups(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_runs_adjustment_anchor_check
    CHECK (
      (run_kind = 'calculation' AND adjusts_reward_run_id IS NULL)
      OR run_kind = 'adjustment'
    )
);

CREATE INDEX IF NOT EXISTS reward_runs_org_close_fixed_idx
  ON public.reward_runs (org_id, month_close_id, fixed_at DESC);

CREATE INDEX IF NOT EXISTS reward_runs_org_status_fixed_idx
  ON public.reward_runs (org_id, status, fixed_at DESC);

CREATE INDEX IF NOT EXISTS reward_runs_adjusts_idx
  ON public.reward_runs (adjusts_reward_run_id)
  WHERE adjusts_reward_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reward_runs_fixed_calculation_once
  ON public.reward_runs (month_close_id, reward_rule_version_id)
  WHERE run_kind = 'calculation' AND status = 'fixed';

CREATE UNIQUE INDEX IF NOT EXISTS reward_runs_proposal_execution_unique
  ON public.reward_runs (proposal_execution_id);

CREATE UNIQUE INDEX IF NOT EXISTS reward_runs_payout_posting_group_unique
  ON public.reward_runs (payout_posting_group_id)
  WHERE payout_posting_group_id IS NOT NULL;

ALTER TABLE public.reward_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_runs" ON public.reward_runs;
DROP POLICY IF EXISTS "Insert reward_runs" ON public.reward_runs;
DROP POLICY IF EXISTS "Update reward_runs" ON public.reward_runs;

CREATE POLICY "Read reward_runs"
ON public.reward_runs
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert reward_runs"
ON public.reward_runs
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update reward_runs"
ON public.reward_runs
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

CREATE TABLE IF NOT EXISTS public.reward_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  reward_run_id uuid NOT NULL REFERENCES public.reward_runs(id) ON DELETE CASCADE,
  month_close_line_id uuid REFERENCES public.month_close_lines(id) ON DELETE SET NULL,
  revenue_basis_id uuid NOT NULL REFERENCES public.revenue_basis(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL,
  base_amount numeric(15, 2) NOT NULL DEFAULT 0,
  delta_amount numeric(15, 2) NOT NULL DEFAULT 0,
  payout_amount numeric(15, 2) NOT NULL DEFAULT 0,
  formula_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_run_lines_amount_balance_check
    CHECK (payout_amount = base_amount + delta_amount)
);

CREATE INDEX IF NOT EXISTS reward_run_lines_run_idx
  ON public.reward_run_lines (reward_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reward_run_lines_month_close_line_idx
  ON public.reward_run_lines (month_close_line_id)
  WHERE month_close_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reward_run_lines_revenue_basis_idx
  ON public.reward_run_lines (revenue_basis_id);

CREATE INDEX IF NOT EXISTS reward_run_lines_recipient_idx
  ON public.reward_run_lines (recipient_id, created_at DESC);

ALTER TABLE public.reward_run_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_run_lines" ON public.reward_run_lines;
DROP POLICY IF EXISTS "Insert reward_run_lines" ON public.reward_run_lines;
DROP POLICY IF EXISTS "Update reward_run_lines" ON public.reward_run_lines;

CREATE POLICY "Read reward_run_lines"
ON public.reward_run_lines
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert reward_run_lines"
ON public.reward_run_lines
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update reward_run_lines"
ON public.reward_run_lines
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'proposals_month_close_id_fkey'
      AND conrelid = 'public.proposals'::regclass
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_month_close_id_fkey
      FOREIGN KEY (month_close_id)
      REFERENCES public.month_closes(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'proposals_adjusts_reward_run_id_fkey'
      AND conrelid = 'public.proposals'::regclass
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_adjusts_reward_run_id_fkey
      FOREIGN KEY (adjusts_reward_run_id)
      REFERENCES public.reward_runs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posting_groups_reward_run_id_fkey'
      AND conrelid = 'public.posting_groups'::regclass
  ) THEN
     ALTER TABLE public.posting_groups
      ADD CONSTRAINT posting_groups_reward_run_id_fkey
      FOREIGN KEY (reward_run_id)
      REFERENCES public.reward_runs(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS posting_groups_reward_run_unique
  ON public.posting_groups (reward_run_id)
  WHERE reward_run_id IS NOT NULL;

COMMENT ON TABLE public.reward_runs IS
  'Canonical immutable reward outputs. reward.calculate and reward.adjust both resolve to reward_runs.';

COMMENT ON COLUMN public.reward_runs.proposal_execution_id IS
  'Governance root anchor. Each successful execution produces at most one canonical reward run.';

COMMENT ON COLUMN public.reward_runs.payout_posting_group_id IS
  'Optional payout posting root. Kept nullable because payout posting can happen after reward run fixation.';

COMMENT ON TABLE public.reward_run_lines IS
  'Canonical per-recipient reward lines. revenue_basis_id is always required even when month_close_line linkage is absent.';
