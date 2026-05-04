-- ============================================================
-- 048: Revenue basis foundation
-- ============================================================
-- 目的:
--   1) site completion を immutable fact として記録する土台を追加
--   2) revenue business lineage root を追加
--   3) proposals に canonical flow 用アンカー列を追加
-- メモ:
--   - legacy write path の停止と hard guard は後続 migration で行う
--   - `income.update` は互換期間のため type check に残しつつ
--     canonical reverse 用に `income.reverse` を追加する
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_completion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  event_type text NOT NULL CHECK (event_type IN ('recorded', 'reversed')),
  effective_completed_at timestamptz NOT NULL,
  reversed_event_id uuid REFERENCES public.site_completion_events(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, sequence_no),
  UNIQUE (idempotency_key),
  CONSTRAINT site_completion_events_reversal_check
    CHECK (
      (event_type = 'recorded' AND reversed_event_id IS NULL)
      OR (event_type = 'reversed' AND reversed_event_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS site_completion_events_org_site_created_idx
  ON public.site_completion_events (org_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS site_completion_events_reversed_event_idx
  ON public.site_completion_events (reversed_event_id)
  WHERE reversed_event_id IS NOT NULL;

ALTER TABLE public.site_completion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_completion_events" ON public.site_completion_events;
DROP POLICY IF EXISTS "Insert site_completion_events" ON public.site_completion_events;

CREATE POLICY "Read site_completion_events"
ON public.site_completion_events
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert site_completion_events"
ON public.site_completion_events
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE TABLE IF NOT EXISTS public.revenue_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  origin_completion_event_id uuid NOT NULL REFERENCES public.site_completion_events(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'reversed', 'superseded')),
  recognition_date date NOT NULL,
  currency text NOT NULL DEFAULT 'JPY',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reversed_by_event_id uuid REFERENCES public.site_completion_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenue_basis_org_site_created_idx
  ON public.revenue_basis (org_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS revenue_basis_org_status_recognition_idx
  ON public.revenue_basis (org_id, status, recognition_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS revenue_basis_origin_completion_unique
  ON public.revenue_basis (origin_completion_event_id);

ALTER TABLE public.revenue_basis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read revenue_basis" ON public.revenue_basis;
DROP POLICY IF EXISTS "Insert revenue_basis" ON public.revenue_basis;
DROP POLICY IF EXISTS "Update revenue_basis" ON public.revenue_basis;

CREATE POLICY "Read revenue_basis"
ON public.revenue_basis
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert revenue_basis"
ON public.revenue_basis
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update revenue_basis"
ON public.revenue_basis
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

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS revenue_basis_id uuid REFERENCES public.revenue_basis(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS month_close_id uuid,
  ADD COLUMN IF NOT EXISTS adjusts_reward_run_id uuid,
  ADD COLUMN IF NOT EXISTS reward_rule_version_id uuid,
  ADD COLUMN IF NOT EXISTS calculation_system text,
  ADD COLUMN IF NOT EXISTS supersedes_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_status_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN (
    'draft',
    'pending',
    'approved',
    'rejected',
    'executed',
    'canceled',
    'superseded'
  ));

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_type_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_type_check
  CHECK (type IN (
    'expense.create',
    'expense.update',
    'expense.void',
    'income.create',
    'income.update',
    'income.reverse',
    'invoice.create',
    'invoice.send',
    'invoice.mark_paid',
    'reward.calculate',
    'reward.adjust',
    'skill.achieve',
    'skill.revoke',
    'evaluation.submit',
    'evaluation.finalize',
    'assignment.create',
    'assignment.update',
    'assignment.cancel',
    'leave.request',
    'communication.review',
    'communication.task',
    'task.revision.request',
    'site.create',
    'site.complete',
    'policy.update',
    'luqo.catalog.add',
    'luqo.star.achieve',
    'luqo.score.update',
    'luqo.reward.calculate'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS proposals_idempotency_key_unique
  ON public.proposals (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS proposals_org_revenue_basis_idx
  ON public.proposals (org_id, revenue_basis_id, created_at DESC)
  WHERE revenue_basis_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proposals_org_month_close_idx
  ON public.proposals (org_id, month_close_id, created_at DESC)
  WHERE month_close_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proposals_supersedes_proposal_idx
  ON public.proposals (supersedes_proposal_id)
  WHERE supersedes_proposal_id IS NOT NULL;

COMMENT ON TABLE public.site_completion_events IS
  'Immutable site completion facts. Completion and reversal are recorded as append-only events.';

COMMENT ON COLUMN public.site_completion_events.sequence_no IS
  'Per-site immutable event sequence number. Revision root is event_id + sequence_no, not sites.completed_at.';

COMMENT ON TABLE public.revenue_basis IS
  'Business lineage anchor for recognized revenue. v1 keeps one revenue_basis per completion event.';

COMMENT ON COLUMN public.proposals.revenue_basis_id IS
  'Canonical business root anchor used by income.create / income.reverse / reward.adjust.';

COMMENT ON COLUMN public.proposals.month_close_id IS
  'Canonical period root anchor for reward.calculate / reward.adjust.';

COMMENT ON COLUMN public.proposals.idempotency_key IS
  'Stable dedupe key for canonical write commands. Timestamp-based keys are prohibited.';
