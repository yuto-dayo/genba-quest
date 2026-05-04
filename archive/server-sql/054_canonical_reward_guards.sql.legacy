-- ============================================================
-- 054: Canonical reward guards
-- ============================================================
-- 目的:
--   1) reward.calculate / reward.adjust の execute hard guard を DB 側に入れる
--   2) fixed month close / reward run / reward-linked journal の mutate を禁止する
--   3) app bug があっても canonical invariant を DB で壊せないようにする
-- ============================================================

CREATE OR REPLACE FUNCTION public.canonical_reward_execution_guard()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS proposals_canonical_reward_execution_guard ON public.proposals;
CREATE TRIGGER proposals_canonical_reward_execution_guard
BEFORE UPDATE OF status ON public.proposals
FOR EACH ROW
EXECUTE FUNCTION public.canonical_reward_execution_guard();

CREATE OR REPLACE FUNCTION public.prevent_fixed_month_close_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('fixed', 'superseded') THEN
    RAISE EXCEPTION 'FIXED_MONTH_CLOSE_IMMUTABLE';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS month_closes_prevent_fixed_mutation ON public.month_closes;
CREATE TRIGGER month_closes_prevent_fixed_mutation
BEFORE UPDATE OR DELETE ON public.month_closes
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_month_close_mutation();

CREATE OR REPLACE FUNCTION public.prevent_fixed_month_close_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_month_close_status text;
  v_month_close_id uuid;
BEGIN
  v_month_close_id := CASE
    WHEN TG_TABLE_NAME = 'month_close_lines' THEN OLD.month_close_id
    ELSE (
      SELECT month_close_id
      FROM public.month_close_lines
      WHERE id = OLD.month_close_line_id
    )
  END;

  SELECT status
  INTO v_month_close_status
  FROM public.month_closes
  WHERE id = v_month_close_id;

  IF v_month_close_status IN ('fixed', 'superseded') THEN
    RAISE EXCEPTION 'FIXED_MONTH_CLOSE_LINES_IMMUTABLE';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS month_close_lines_prevent_fixed_mutation ON public.month_close_lines;
CREATE TRIGGER month_close_lines_prevent_fixed_mutation
BEFORE UPDATE OR DELETE ON public.month_close_lines
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_month_close_line_mutation();

DROP TRIGGER IF EXISTS month_close_line_sources_prevent_fixed_mutation ON public.month_close_line_sources;
CREATE TRIGGER month_close_line_sources_prevent_fixed_mutation
BEFORE UPDATE OR DELETE ON public.month_close_line_sources
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_month_close_line_mutation();

CREATE OR REPLACE FUNCTION public.prevent_fixed_reward_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('fixed', 'superseded') THEN
      RAISE EXCEPTION 'FIXED_REWARD_RUN_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'FIXED_REWARD_RUN_IMMUTABLE';
  END IF;

  IF OLD.status = 'fixed' THEN
    IF NOT (
      NEW.status = OLD.status
      AND NEW.org_id = OLD.org_id
      AND NEW.run_kind = OLD.run_kind
      AND NEW.month_close_id = OLD.month_close_id
      AND NEW.proposal_execution_id = OLD.proposal_execution_id
      AND NEW.reward_rule_version_id = OLD.reward_rule_version_id
      AND NEW.calculation_system = OLD.calculation_system
      AND NEW.adjusts_reward_run_id IS NOT DISTINCT FROM OLD.adjusts_reward_run_id
      AND NEW.fixed_at = OLD.fixed_at
      AND NEW.created_at = OLD.created_at
      AND OLD.payout_posting_group_id IS NULL
      AND NEW.payout_posting_group_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'FIXED_REWARD_RUN_IMMUTABLE';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reward_runs_prevent_fixed_mutation ON public.reward_runs;
CREATE TRIGGER reward_runs_prevent_fixed_mutation
BEFORE UPDATE OR DELETE ON public.reward_runs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_reward_run_mutation();

CREATE OR REPLACE FUNCTION public.prevent_fixed_reward_run_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_reward_run_status text;
  v_reward_run_id uuid;
BEGIN
  v_reward_run_id := CASE
    WHEN TG_TABLE_NAME = 'reward_run_lines' THEN OLD.reward_run_id
    WHEN TG_TABLE_NAME = 'posting_groups' THEN OLD.reward_run_id
    WHEN TG_TABLE_NAME = 'accounting_journal_entries' THEN (
      SELECT reward_run_id
      FROM public.posting_groups
      WHERE id = OLD.posting_group_id
    )
    ELSE (
      SELECT pg.reward_run_id
      FROM public.accounting_journal_entries aje
      JOIN public.posting_groups pg
        ON pg.id = aje.posting_group_id
      WHERE aje.id = OLD.entry_id
    )
  END;

  IF v_reward_run_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status
  INTO v_reward_run_status
  FROM public.reward_runs
  WHERE id = v_reward_run_id;

  IF v_reward_run_status IN ('fixed', 'superseded') THEN
    RAISE EXCEPTION 'FIXED_REWARD_RUN_LINES_IMMUTABLE';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS reward_run_lines_prevent_fixed_mutation ON public.reward_run_lines;
CREATE TRIGGER reward_run_lines_prevent_fixed_mutation
BEFORE UPDATE OR DELETE ON public.reward_run_lines
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_reward_run_line_mutation();

DROP TRIGGER IF EXISTS posting_groups_prevent_fixed_reward_mutation ON public.posting_groups;
CREATE TRIGGER posting_groups_prevent_fixed_reward_mutation
BEFORE UPDATE OR DELETE ON public.posting_groups
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_reward_run_line_mutation();

DROP TRIGGER IF EXISTS accounting_journal_entries_prevent_fixed_reward_mutation ON public.accounting_journal_entries;
CREATE TRIGGER accounting_journal_entries_prevent_fixed_reward_mutation
BEFORE UPDATE OR DELETE ON public.accounting_journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_reward_run_line_mutation();

DROP TRIGGER IF EXISTS accounting_journal_lines_prevent_fixed_reward_mutation ON public.accounting_journal_lines;
CREATE TRIGGER accounting_journal_lines_prevent_fixed_reward_mutation
BEFORE UPDATE OR DELETE ON public.accounting_journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fixed_reward_run_line_mutation();

COMMENT ON FUNCTION public.canonical_reward_execution_guard() IS
  'Hard fail reward.calculate / reward.adjust execution unless canonical anchors and fixed month close requirements are satisfied.';

COMMENT ON FUNCTION public.prevent_fixed_month_close_mutation() IS
  'Prevents update/delete on fixed or superseded month_closes.';

COMMENT ON FUNCTION public.prevent_fixed_month_close_line_mutation() IS
  'Prevents update/delete on month_close_lines and month_close_line_sources once the parent month_close is fixed or superseded.';

COMMENT ON FUNCTION public.prevent_fixed_reward_run_mutation() IS
  'Prevents update/delete on fixed or superseded reward_runs, except a one-time payout_posting_group_id fill after fixation.';

COMMENT ON FUNCTION public.prevent_fixed_reward_run_line_mutation() IS
  'Prevents update/delete on reward-linked lines, posting_groups, and journals once the parent reward_run is fixed or superseded.';
