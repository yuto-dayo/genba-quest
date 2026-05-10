-- PATH V3.3 transparent governance Phase 1: schema only.
-- Adds two new tables (site_member_level_drafts, level_objections) and
-- extends path_member_level_history with V3.3 aggregation snapshot columns.
-- Old V3.2 simple flow keeps writing to path_member_level_history.level
-- (already accepts L1..L5 via CHECK), so no enum migration is needed.
--
-- Related: docs/REWARD_SYSTEM_V33.md §5

-- 1. site_member_level_drafts: per-site self-declared 3-tier (1=補助 / 2=標準 / 3=主導).
CREATE TABLE IF NOT EXISTS public.site_member_level_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  tier int2 NOT NULL CHECK (tier IN (1, 2, 3)),
  work_days int2 NOT NULL DEFAULT 0 CHECK (work_days >= 0),
  self_comment text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, site_id, member_id)
);

CREATE INDEX IF NOT EXISTS site_member_level_drafts_member_idx
  ON public.site_member_level_drafts (org_id, member_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS site_member_level_drafts_site_idx
  ON public.site_member_level_drafts (org_id, site_id);

ALTER TABLE public.site_member_level_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_member_level_drafts" ON public.site_member_level_drafts;
CREATE POLICY "Read site_member_level_drafts"
  ON public.site_member_level_drafts
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS site_member_level_drafts_set_updated_at
  ON public.site_member_level_drafts;
CREATE TRIGGER site_member_level_drafts_set_updated_at
  BEFORE UPDATE ON public.site_member_level_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON TABLE public.site_member_level_drafts TO authenticated;
GRANT ALL ON TABLE public.site_member_level_drafts TO service_role;

COMMENT ON TABLE public.site_member_level_drafts IS
  'PATH V3.3 per-site self tier declaration (1=補助 / 2=標準 / 3=主導). Writes are proposal/service-role only.';

-- 2. level_objections: peer-review objection + co-sign records.
CREATE TABLE IF NOT EXISTS public.level_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  target_member_id uuid NOT NULL,
  target_month text NOT NULL CHECK (target_month ~ '^\d{4}-\d{2}$'),
  target_draft_id uuid NOT NULL REFERENCES public.site_member_level_drafts(id) ON DELETE CASCADE,
  objector_id uuid NOT NULL,
  proposed_tier int2 NOT NULL CHECK (proposed_tier IN (1, 2, 3)),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  co_signs jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_self_response jsonb,
  required_co_signs int2 NOT NULL CHECK (required_co_signs >= 1),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_tier int2 CHECK (resolved_tier IS NULL OR resolved_tier IN (1, 2, 3)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS level_objections_target_idx
  ON public.level_objections (org_id, target_member_id, target_month);
CREATE INDEX IF NOT EXISTS level_objections_status_expiry_idx
  ON public.level_objections (org_id, status, expires_at);

ALTER TABLE public.level_objections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read level_objections" ON public.level_objections;
CREATE POLICY "Read level_objections"
  ON public.level_objections
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS level_objections_set_updated_at ON public.level_objections;
CREATE TRIGGER level_objections_set_updated_at
  BEFORE UPDATE ON public.level_objections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON TABLE public.level_objections TO authenticated;
GRANT ALL ON TABLE public.level_objections TO service_role;

COMMENT ON TABLE public.level_objections IS
  'PATH V3.3 peer-review objection + co-sign records (replaces 番頭 approval).';

-- 3. Extend path_member_level_history with V3.3 aggregation snapshot columns.
-- The existing level CHECK already accepts L1..L5, so no enum work needed.
ALTER TABLE public.path_member_level_history
  ADD COLUMN IF NOT EXISTS computed_score numeric(5, 2),
  ADD COLUMN IF NOT EXISTS aggregation_snapshot jsonb;

COMMENT ON COLUMN public.path_member_level_history.computed_score IS
  'PATH V3.3 weighted-average score (Σ tier × work_days / Σ work_days). Null for legacy V3.2 rows.';
COMMENT ON COLUMN public.path_member_level_history.aggregation_snapshot IS
  'PATH V3.3 snapshot of all drafts used to compute the score (member_id, site_id, tier, work_days).';
