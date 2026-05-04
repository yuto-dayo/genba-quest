-- ============================================================
-- PATH Evaluation Evidence (Phase 2 foundation)
-- ============================================================
-- 目的:
--   1) 月末フォームの証跡を保存する
--   2) AI 整理結果を candidate として保存する
-- ============================================================

CREATE TABLE IF NOT EXISTS public.monthly_evaluation_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  selected_big_skill_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  site_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_flag boolean NOT NULL DEFAULT false,
  rework_flag text NOT NULL DEFAULT 'none'
    CHECK (rework_flag IN ('none', 'minor', 'major')),
  comment text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, member_id)
);

CREATE INDEX IF NOT EXISTS monthly_eval_forms_org_month_idx
  ON public.monthly_evaluation_forms (org_id, month, submitted_at DESC);

CREATE INDEX IF NOT EXISTS monthly_eval_forms_member_idx
  ON public.monthly_evaluation_forms (org_id, member_id, submitted_at DESC);

ALTER TABLE public.monthly_evaluation_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read monthly_evaluation_forms" ON public.monthly_evaluation_forms;
CREATE POLICY "Read monthly_evaluation_forms"
ON public.monthly_evaluation_forms
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert monthly_evaluation_forms" ON public.monthly_evaluation_forms;
CREATE POLICY "Insert monthly_evaluation_forms"
ON public.monthly_evaluation_forms
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update monthly_evaluation_forms" ON public.monthly_evaluation_forms;
CREATE POLICY "Update monthly_evaluation_forms"
ON public.monthly_evaluation_forms
FOR UPDATE TO authenticated
USING (true);

CREATE TABLE IF NOT EXISTS public.monthly_evaluation_ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  monthly_summary text NOT NULL,
  candidate_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_skill_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_update_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  promotion_candidate_flag boolean NOT NULL DEFAULT false,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  unknown_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_required_flag boolean NOT NULL DEFAULT false,
  generated_by jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, member_id)
);

CREATE INDEX IF NOT EXISTS monthly_eval_ai_reviews_org_month_idx
  ON public.monthly_evaluation_ai_reviews (org_id, month, generated_at DESC);

CREATE INDEX IF NOT EXISTS monthly_eval_ai_reviews_member_idx
  ON public.monthly_evaluation_ai_reviews (org_id, member_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS monthly_eval_ai_reviews_review_flag_idx
  ON public.monthly_evaluation_ai_reviews (org_id, review_required_flag, generated_at DESC);

ALTER TABLE public.monthly_evaluation_ai_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read monthly_evaluation_ai_reviews" ON public.monthly_evaluation_ai_reviews;
CREATE POLICY "Read monthly_evaluation_ai_reviews"
ON public.monthly_evaluation_ai_reviews
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert monthly_evaluation_ai_reviews" ON public.monthly_evaluation_ai_reviews;
CREATE POLICY "Insert monthly_evaluation_ai_reviews"
ON public.monthly_evaluation_ai_reviews
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update monthly_evaluation_ai_reviews" ON public.monthly_evaluation_ai_reviews;
CREATE POLICY "Update monthly_evaluation_ai_reviews"
ON public.monthly_evaluation_ai_reviews
FOR UPDATE TO authenticated
USING (true);
