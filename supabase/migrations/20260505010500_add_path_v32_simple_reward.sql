-- PATH V3.2 Simple monthly team-pool reward distribution.
-- Client writes stay closed; server service-role writes produce immutable snapshots.

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_type_check;
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_type_check
  CHECK (
    type = ANY (
      ARRAY[
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
        'reward.pool.adjust',
        'path.level.update',
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
        'site.close.finalize',
        'site.close.reopen',
        'policy.update',
        'luqo.catalog.add',
        'luqo.star.achieve',
        'luqo.score.update',
        'luqo.reward.calculate'
      ]::text[]
    )
  );

ALTER TABLE public.reward_runs DROP CONSTRAINT IF EXISTS reward_runs_calculation_system_check;
ALTER TABLE public.reward_runs
  ADD CONSTRAINT reward_runs_calculation_system_check
  CHECK (calculation_system = ANY (ARRAY['path_v22', 'path_v31', 'path_v32_simple']::text[]));

ALTER TABLE public.member_skill_profiles DROP CONSTRAINT IF EXISTS member_skill_profiles_current_level_check;
ALTER TABLE public.member_skill_profiles
  ADD CONSTRAINT member_skill_profiles_current_level_check
  CHECK (current_level IS NULL OR current_level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[]));

ALTER TABLE public.monthly_evaluation_finalizations DROP CONSTRAINT IF EXISTS monthly_evaluation_finalizations_current_level_check;
ALTER TABLE public.monthly_evaluation_finalizations
  ADD CONSTRAINT monthly_evaluation_finalizations_current_level_check
  CHECK (current_level IS NULL OR current_level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[]));

ALTER TABLE public.monthly_evaluation_forms DROP CONSTRAINT IF EXISTS monthly_evaluation_forms_current_level_check;
ALTER TABLE public.monthly_evaluation_forms
  ADD CONSTRAINT monthly_evaluation_forms_current_level_check
  CHECK (current_level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[]));

ALTER TABLE public.path_month_closes DROP CONSTRAINT IF EXISTS path_month_closes_current_role_level_check;
ALTER TABLE public.path_month_closes
  ADD CONSTRAINT path_month_closes_current_role_level_check
  CHECK (current_role_level IS NULL OR current_role_level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[]));

ALTER TABLE public.path_monthly_close_inputs DROP CONSTRAINT IF EXISTS path_monthly_close_inputs_role_level_check;
ALTER TABLE public.path_monthly_close_inputs
  ADD CONSTRAINT path_monthly_close_inputs_role_level_check
  CHECK (role_level IS NULL OR role_level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[]));

ALTER TABLE public.reward_basis_member_snapshots DROP CONSTRAINT IF EXISTS reward_basis_member_snapshots_role_level_check;
ALTER TABLE public.reward_basis_member_snapshots
  ADD CONSTRAINT reward_basis_member_snapshots_role_level_check
  CHECK (role_level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[]));

CREATE TABLE IF NOT EXISTS public.site_close_member_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_close_id uuid NOT NULL REFERENCES public.site_closes(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  work_date date NOT NULL,
  participation_role text NOT NULL DEFAULT 'member',
  memo text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_close_id, member_id, work_date)
);

CREATE INDEX IF NOT EXISTS site_close_member_units_org_month_idx
  ON public.site_close_member_units (org_id, work_date, member_id);

CREATE INDEX IF NOT EXISTS site_close_member_units_close_idx
  ON public.site_close_member_units (site_close_id, member_id, work_date);

ALTER TABLE public.site_close_member_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_close_member_units" ON public.site_close_member_units;
CREATE POLICY "Read site_close_member_units"
  ON public.site_close_member_units
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS site_close_member_units_set_updated_at ON public.site_close_member_units;
CREATE TRIGGER site_close_member_units_set_updated_at
  BEFORE UPDATE ON public.site_close_member_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON TABLE public.site_close_member_units TO authenticated;
GRANT ALL ON TABLE public.site_close_member_units TO service_role;

CREATE TABLE IF NOT EXISTS public.path_member_level_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  member_id uuid NOT NULL,
  level text NOT NULL CHECK (level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[])),
  effective_month text NOT NULL CHECK (effective_month ~ '^\d{4}-\d{2}$'),
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '',
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, member_id, effective_month)
);

CREATE INDEX IF NOT EXISTS path_member_level_history_org_member_idx
  ON public.path_member_level_history (org_id, member_id, effective_month DESC);

ALTER TABLE public.path_member_level_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_member_level_history" ON public.path_member_level_history;
CREATE POLICY "Read path_member_level_history"
  ON public.path_member_level_history
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS path_member_level_history_set_updated_at ON public.path_member_level_history;
CREATE TRIGGER path_member_level_history_set_updated_at
  BEFORE UPDATE ON public.path_member_level_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON TABLE public.path_member_level_history TO authenticated;
GRANT ALL ON TABLE public.path_member_level_history TO service_role;

ALTER TABLE public.monthly_distribution_lines
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS level_source text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS level_weight_milli integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS month_total_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_work_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_presence_bp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_weight_num integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_weight_num_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_share_bp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_amount numeric(15, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounded_amount numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS member_correction_amount numeric(15, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.monthly_distribution_lines DROP CONSTRAINT IF EXISTS monthly_distribution_lines_v32_level_check;
ALTER TABLE public.monthly_distribution_lines
  ADD CONSTRAINT monthly_distribution_lines_v32_level_check
  CHECK (level IS NULL OR level = ANY (ARRAY['L1', 'L2', 'L3', 'L4', 'L5']::text[]));

ALTER TABLE public.monthly_distribution_lines DROP CONSTRAINT IF EXISTS monthly_distribution_lines_v32_level_source_check;
ALTER TABLE public.monthly_distribution_lines
  ADD CONSTRAINT monthly_distribution_lines_v32_level_source_check
  CHECK (level_source = ANY (ARRAY['history', 'profile', 'default']::text[]));

CREATE OR REPLACE FUNCTION public.canonical_reward_execution_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO public, pg_temp
AS $$
DECLARE
  v_calculation_system text;
  v_month_close_id uuid;
  v_revenue_basis_id uuid;
  v_month_close_status text;
  v_dummy uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.status, '') = 'executed' OR NEW.status <> 'executed' THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('reward.calculate', 'reward.adjust') THEN
    RETURN NEW;
  END IF;

  v_calculation_system := COALESCE(
    NULLIF(NEW.calculation_system, ''),
    NULLIF(NEW.payload->>'calculation_system', ''),
    ''
  );

  IF NEW.type = 'reward.calculate'
     AND v_calculation_system IN ('path_v31', 'path_v32_simple')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'reward.adjust' AND v_calculation_system = 'path_v32_simple' THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'reward.calculate' AND v_calculation_system <> 'path_v22' THEN
    RAISE EXCEPTION 'REWARD_CALCULATE_PATH_V22_REQUIRED';
  END IF;

  IF NEW.type = 'reward.adjust' AND v_calculation_system <> 'path_v22' THEN
    RAISE EXCEPTION 'REWARD_ADJUST_PATH_V22_REQUIRED';
  END IF;

  v_month_close_id := NEW.month_close_id;
  IF v_month_close_id IS NULL
     AND COALESCE(NEW.payload->>'month_close_id', '') ~* '^[0-9a-fA-F-]{36}$'
  THEN
    v_month_close_id := (NEW.payload->>'month_close_id')::uuid;
  END IF;

  IF v_month_close_id IS NULL THEN
    IF NEW.type = 'reward.calculate' THEN
      RAISE EXCEPTION 'REWARD_CALCULATE_MONTH_CLOSE_REQUIRED';
    ELSE
      RAISE EXCEPTION 'REWARD_ADJUST_MONTH_CLOSE_REQUIRED';
    END IF;
  END IF;

  SELECT status
  INTO v_month_close_status
  FROM public.month_closes
  WHERE id = v_month_close_id
    AND org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MONTH_CLOSE_NOT_FOUND';
  END IF;

  IF v_month_close_status <> 'fixed' THEN
    IF NEW.type = 'reward.calculate' THEN
      RAISE EXCEPTION 'REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE';
    ELSE
      RAISE EXCEPTION 'REWARD_ADJUST_REQUIRES_FIXED_MONTH_CLOSE';
    END IF;
  END IF;

  IF NEW.type = 'reward.adjust' THEN
    v_revenue_basis_id := NEW.revenue_basis_id;
    IF v_revenue_basis_id IS NULL
       AND COALESCE(NEW.payload->>'revenue_basis_id', '') ~* '^[0-9a-fA-F-]{36}$'
    THEN
      v_revenue_basis_id := (NEW.payload->>'revenue_basis_id')::uuid;
    END IF;

    IF v_revenue_basis_id IS NULL THEN
      RAISE EXCEPTION 'REWARD_ADJUST_REVENUE_BASIS_REQUIRED';
    END IF;

    SELECT id
    INTO v_dummy
    FROM public.revenue_basis
    WHERE id = v_revenue_basis_id
      AND org_id = NEW.org_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REVENUE_BASIS_NOT_FOUND';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON TABLE public.site_close_member_units IS
  'PATH V3.2 Simple lightweight work-day evidence frozen at site close.';

COMMENT ON TABLE public.path_member_level_history IS
  'PATH V3.2 Simple member level history. Writes are proposal/service-role only.';
