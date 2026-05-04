-- ============================================================
-- PATH Profile Recognition (Phase 3 foundation)
-- ============================================================
-- 目的:
--   1) 熟練者確認の証跡を保存する
--   2) PATH current profile を保持する
--   3) 詳細技能認定の current 状態を保持する
-- ============================================================

CREATE TABLE IF NOT EXISTS public.monthly_evaluation_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  target_type text NOT NULL
    CHECK (target_type IN ('big_skill', 'skill_tag', 'level')),
  target_key text NOT NULL,
  confirmation_status text NOT NULL,
  comment text NOT NULL DEFAULT '',
  confirmed_by jsonb,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, member_id, target_type, target_key)
);

CREATE INDEX IF NOT EXISTS monthly_eval_confirmations_org_month_idx
  ON public.monthly_evaluation_confirmations (org_id, month, confirmed_at DESC);

CREATE INDEX IF NOT EXISTS monthly_eval_confirmations_member_idx
  ON public.monthly_evaluation_confirmations (org_id, member_id, confirmed_at DESC);

ALTER TABLE public.monthly_evaluation_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read monthly_evaluation_confirmations" ON public.monthly_evaluation_confirmations;
CREATE POLICY "Read monthly_evaluation_confirmations"
ON public.monthly_evaluation_confirmations
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert monthly_evaluation_confirmations" ON public.monthly_evaluation_confirmations;
CREATE POLICY "Insert monthly_evaluation_confirmations"
ON public.monthly_evaluation_confirmations
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update monthly_evaluation_confirmations" ON public.monthly_evaluation_confirmations;
CREATE POLICY "Update monthly_evaluation_confirmations"
ON public.monthly_evaluation_confirmations
FOR UPDATE TO authenticated
USING (true);

CREATE TABLE IF NOT EXISTS public.member_skill_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  member_id uuid NOT NULL,
  current_level text
    CHECK (current_level IS NULL OR current_level IN ('L1', 'L2', 'L3', 'L4')),
  current_level_since timestamptz,
  cross_work_status text NOT NULL DEFAULT 'unverified',
  putty_foundation_status text NOT NULL DEFAULT 'unverified',
  planning_preparation_status text NOT NULL DEFAULT 'unverified',
  quality_stability_status text NOT NULL DEFAULT 'unverified',
  site_trust_status text NOT NULL DEFAULT 'unverified',
  education_support_status text NOT NULL DEFAULT 'unverified',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, member_id)
);

CREATE INDEX IF NOT EXISTS member_skill_profiles_org_member_idx
  ON public.member_skill_profiles (org_id, member_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS member_skill_profiles_level_idx
  ON public.member_skill_profiles (org_id, current_level, updated_at DESC);

ALTER TABLE public.member_skill_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read member_skill_profiles" ON public.member_skill_profiles;
CREATE POLICY "Read member_skill_profiles"
ON public.member_skill_profiles
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert member_skill_profiles" ON public.member_skill_profiles;
CREATE POLICY "Insert member_skill_profiles"
ON public.member_skill_profiles
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update member_skill_profiles" ON public.member_skill_profiles;
CREATE POLICY "Update member_skill_profiles"
ON public.member_skill_profiles
FOR UPDATE TO authenticated
USING (true);

CREATE TABLE IF NOT EXISTS public.member_skill_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  member_id uuid NOT NULL,
  skill_key text NOT NULL,
  category text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('candidate', 'verified', 'review_required', 'revoked')),
  verified_by jsonb,
  verified_at timestamptz NOT NULL DEFAULT now(),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  last_site_id uuid,
  note text NOT NULL DEFAULT '',
  review_required_flag boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, member_id, skill_key)
);

CREATE INDEX IF NOT EXISTS member_skill_certifications_org_member_idx
  ON public.member_skill_certifications (org_id, member_id, verified_at DESC);

CREATE INDEX IF NOT EXISTS member_skill_certifications_status_idx
  ON public.member_skill_certifications (org_id, status, verified_at DESC);

CREATE INDEX IF NOT EXISTS member_skill_certifications_review_flag_idx
  ON public.member_skill_certifications (org_id, review_required_flag, verified_at DESC);

ALTER TABLE public.member_skill_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read member_skill_certifications" ON public.member_skill_certifications;
CREATE POLICY "Read member_skill_certifications"
ON public.member_skill_certifications
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert member_skill_certifications" ON public.member_skill_certifications;
CREATE POLICY "Insert member_skill_certifications"
ON public.member_skill_certifications
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update member_skill_certifications" ON public.member_skill_certifications;
CREATE POLICY "Update member_skill_certifications"
ON public.member_skill_certifications
FOR UPDATE TO authenticated
USING (true);
