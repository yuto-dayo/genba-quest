-- ============================================================
-- PATH Evaluation Finalizations
-- ============================================================
-- 目的:
--   1) evaluation.finalize の確定値を月次 read model として保存する
--   2) atomic RPC 実行でも profile / confirmation / finalization が欠けないようにする
-- ============================================================

CREATE TABLE IF NOT EXISTS public.monthly_evaluation_finalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  confirmed_big_skill_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  work_days integer NOT NULL DEFAULT 0 CHECK (work_days >= 0),
  A integer NOT NULL DEFAULT 1 CHECK (A BETWEEN 0 AND 2),
  R integer NOT NULL DEFAULT 1 CHECK (R BETWEEN 0 AND 2),
  Q integer NOT NULL DEFAULT 1 CHECK (Q BETWEEN 0 AND 2),
  current_level text
    CHECK (current_level IS NULL OR current_level IN ('L1', 'L2', 'L3', 'L4')),
  comment text NOT NULL DEFAULT '',
  finalized_by jsonb,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, member_id)
);

CREATE INDEX IF NOT EXISTS monthly_eval_finalizations_org_month_idx
  ON public.monthly_evaluation_finalizations (org_id, month, finalized_at DESC);

CREATE INDEX IF NOT EXISTS monthly_eval_finalizations_member_idx
  ON public.monthly_evaluation_finalizations (org_id, member_id, finalized_at DESC);

ALTER TABLE public.monthly_evaluation_finalizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read monthly_evaluation_finalizations" ON public.monthly_evaluation_finalizations;
CREATE POLICY "Read monthly_evaluation_finalizations"
ON public.monthly_evaluation_finalizations
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert monthly_evaluation_finalizations" ON public.monthly_evaluation_finalizations;
CREATE POLICY "Insert monthly_evaluation_finalizations"
ON public.monthly_evaluation_finalizations
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update monthly_evaluation_finalizations" ON public.monthly_evaluation_finalizations;
CREATE POLICY "Update monthly_evaluation_finalizations"
ON public.monthly_evaluation_finalizations
FOR UPDATE TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.capture_path_evaluation_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
  v_month text;
  v_states jsonb;
  v_current_level text;
  v_comment text;
  v_finalized_at timestamptz;
  v_work_days integer;
  v_a integer;
  v_r integer;
  v_q integer;
  v_key text;
  v_value text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.type <> 'evaluation.finalize'
    OR NEW.status <> 'executed'
    OR COALESCE(OLD.status, '') = 'executed'
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.payload->>'member_id', '') !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RETURN NEW;
  END IF;

  v_member_id := (NEW.payload->>'member_id')::uuid;
  v_month := COALESCE(NULLIF(NEW.payload->>'month', ''), TO_CHAR(COALESCE(NEW.executed_at, now()), 'YYYY-MM'));
  v_states := COALESCE(NEW.payload->'confirmed_big_skill_states', '{}'::jsonb);
  v_current_level := NULLIF(NEW.payload->>'current_level', '');
  v_comment := COALESCE(NEW.payload->>'comment', '');
  v_finalized_at := COALESCE(NEW.executed_at, now());
  v_work_days := GREATEST(COALESCE((NEW.payload->>'work_days')::integer, 0), 0);
  v_a := LEAST(GREATEST(COALESCE((NEW.payload->>'A')::integer, 1), 0), 2);
  v_r := LEAST(GREATEST(COALESCE((NEW.payload->>'R')::integer, 1), 0), 2);
  v_q := LEAST(GREATEST(COALESCE((NEW.payload->>'Q')::integer, 1), 0), 2);

  INSERT INTO public.member_skill_profiles (
    org_id,
    member_id,
    current_level,
    current_level_since,
    cross_work_status,
    putty_foundation_status,
    planning_preparation_status,
    quality_stability_status,
    site_trust_status,
    education_support_status,
    updated_at
  ) VALUES (
    NEW.org_id,
    v_member_id,
    CASE WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_current_level ELSE NULL END,
    CASE WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_finalized_at ELSE NULL END,
    COALESCE(v_states->>'cross_work', 'unverified'),
    COALESCE(v_states->>'putty_foundation', 'unverified'),
    COALESCE(v_states->>'planning_preparation', 'unverified'),
    COALESCE(v_states->>'quality_stability', 'unverified'),
    COALESCE(v_states->>'site_trust', 'unverified'),
    COALESCE(v_states->>'education_support', 'unverified'),
    v_finalized_at
  )
  ON CONFLICT (org_id, member_id) DO UPDATE
    SET cross_work_status = COALESCE(v_states->>'cross_work', public.member_skill_profiles.cross_work_status),
        putty_foundation_status = COALESCE(v_states->>'putty_foundation', public.member_skill_profiles.putty_foundation_status),
        planning_preparation_status = COALESCE(v_states->>'planning_preparation', public.member_skill_profiles.planning_preparation_status),
        quality_stability_status = COALESCE(v_states->>'quality_stability', public.member_skill_profiles.quality_stability_status),
        site_trust_status = COALESCE(v_states->>'site_trust', public.member_skill_profiles.site_trust_status),
        education_support_status = COALESCE(v_states->>'education_support', public.member_skill_profiles.education_support_status),
        current_level = CASE
          WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_current_level
          ELSE public.member_skill_profiles.current_level
        END,
        current_level_since = CASE
          WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_finalized_at
          ELSE public.member_skill_profiles.current_level_since
        END,
        updated_at = v_finalized_at;

  FOR v_key, v_value IN
    SELECT key, value
    FROM jsonb_each_text(v_states)
  LOOP
    IF v_key IN (
      'cross_work',
      'putty_foundation',
      'planning_preparation',
      'quality_stability',
      'site_trust',
      'education_support'
    ) THEN
      INSERT INTO public.monthly_evaluation_confirmations (
        org_id,
        month,
        member_id,
        target_type,
        target_key,
        confirmation_status,
        comment,
        confirmed_by,
        confirmed_at,
        updated_at
      ) VALUES (
        NEW.org_id,
        v_month,
        v_member_id,
        'big_skill',
        v_key,
        v_value,
        v_comment,
        NEW.executed_by,
        v_finalized_at,
        v_finalized_at
      )
      ON CONFLICT (org_id, month, member_id, target_type, target_key) DO UPDATE
        SET confirmation_status = EXCLUDED.confirmation_status,
            comment = EXCLUDED.comment,
            confirmed_by = EXCLUDED.confirmed_by,
            confirmed_at = EXCLUDED.confirmed_at,
            updated_at = EXCLUDED.updated_at;
    END IF;
  END LOOP;

  INSERT INTO public.monthly_evaluation_finalizations (
    org_id,
    month,
    member_id,
    proposal_id,
    confirmed_big_skill_states,
    work_days,
    A,
    R,
    Q,
    current_level,
    comment,
    finalized_by,
    finalized_at,
    updated_at
  ) VALUES (
    NEW.org_id,
    v_month,
    v_member_id,
    NEW.id,
    v_states,
    v_work_days,
    v_a,
    v_r,
    v_q,
    CASE WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_current_level ELSE NULL END,
    v_comment,
    NEW.executed_by,
    v_finalized_at,
    v_finalized_at
  )
  ON CONFLICT (org_id, month, member_id) DO UPDATE
    SET proposal_id = EXCLUDED.proposal_id,
        confirmed_big_skill_states = EXCLUDED.confirmed_big_skill_states,
        work_days = EXCLUDED.work_days,
        A = EXCLUDED.A,
        R = EXCLUDED.R,
        Q = EXCLUDED.Q,
        current_level = EXCLUDED.current_level,
        comment = EXCLUDED.comment,
        finalized_by = EXCLUDED.finalized_by,
        finalized_at = EXCLUDED.finalized_at,
        updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_path_evaluation_finalize_trigger ON public.proposals;
CREATE TRIGGER proposals_path_evaluation_finalize_trigger
AFTER UPDATE ON public.proposals
FOR EACH ROW
EXECUTE FUNCTION public.capture_path_evaluation_finalize();
