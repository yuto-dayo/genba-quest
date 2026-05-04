-- ============================================================
-- 062: Allow PATH V3.1 reward.calculate through canonical execute guard
-- ============================================================
-- 目的:
--   1) 054 の canonical_reward_execution_guard が reward.calculate を
--      path_v22 専用で hard fail していた不整合を解消する
--   2) reward.calculate(path_v31) を Proposal execute fallback から通せるようにする
--   3) reward.adjust は従来どおり path_v22 制約のまま維持する
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

  IF NEW.type = 'reward.calculate' AND v_calculation_system NOT IN ('path_v22', 'path_v31') THEN
    RAISE EXCEPTION 'REWARD_CALCULATE_PATH_V22_OR_V31_REQUIRED';
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

COMMENT ON FUNCTION public.canonical_reward_execution_guard() IS
  'Hard fail reward.calculate / reward.adjust execution unless canonical anchors and fixed month close requirements are satisfied. reward.calculate accepts path_v22 and path_v31.';
