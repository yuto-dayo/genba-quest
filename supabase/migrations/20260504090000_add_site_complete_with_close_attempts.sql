-- Forward rewrite of legacy server/sql/064_site_complete_with_close_attempts.sql.
-- Direct client writes stay closed; orchestration writes use the server service role.

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
CREATE POLICY "Read site_complete_with_close_attempts"
  ON public.site_complete_with_close_attempts
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS site_complete_with_close_attempts_set_updated_at ON public.site_complete_with_close_attempts;
CREATE TRIGGER site_complete_with_close_attempts_set_updated_at
  BEFORE UPDATE ON public.site_complete_with_close_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON TABLE public.site_complete_with_close_attempts TO authenticated;
GRANT ALL ON TABLE public.site_complete_with_close_attempts TO service_role;

COMMENT ON TABLE public.site_complete_with_close_attempts IS
  'Idempotent site completion + site close orchestration attempts. Writes are server-only.';
