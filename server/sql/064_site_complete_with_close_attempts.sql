-- 064: Site complete-with-close orchestration attempts
-- Purpose:
--   - track idempotent site completion + site close submission attempts
--   - persist response replay for duplicate client_request_id retries
--   - retain recovery metadata when orchestration needs manual intervention

CREATE TABLE IF NOT EXISTS public.site_complete_with_close_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  client_request_id text NOT NULL,
  payload_hash text NOT NULL,
  phase text NOT NULL DEFAULT 'started'
    CHECK (
      phase IN (
        'started',
        'site_revenue_updated',
        'site_completed',
        'close_submitted',
        'completed',
        'failed',
        'reversed',
        'recovery_required'
      )
    ),
  outcome text
    CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed', 'recovery_required')),
  prior_site_revenue numeric,
  site_completion_event_id uuid REFERENCES public.site_completion_events(id) ON DELETE SET NULL,
  revenue_basis_id uuid REFERENCES public.revenue_basis(id) ON DELETE SET NULL,
  income_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  close_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  reversal_event_id uuid REFERENCES public.site_completion_events(id) ON DELETE SET NULL,
  response_status integer,
  response_json jsonb,
  recovery_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS site_complete_with_close_attempts_org_site_idx
  ON public.site_complete_with_close_attempts (org_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS site_complete_with_close_attempts_phase_idx
  ON public.site_complete_with_close_attempts (org_id, phase, updated_at DESC);

ALTER TABLE public.site_complete_with_close_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_complete_with_close_attempts" ON public.site_complete_with_close_attempts;
DROP POLICY IF EXISTS "Insert site_complete_with_close_attempts" ON public.site_complete_with_close_attempts;
DROP POLICY IF EXISTS "Update site_complete_with_close_attempts" ON public.site_complete_with_close_attempts;

CREATE POLICY "Read site_complete_with_close_attempts"
ON public.site_complete_with_close_attempts
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert site_complete_with_close_attempts"
ON public.site_complete_with_close_attempts
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update site_complete_with_close_attempts"
ON public.site_complete_with_close_attempts
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
