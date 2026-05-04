-- ============================================================
-- PATH Reward Core (Phase 1)
-- ============================================================
-- 目的:
--   1) PATH v2 の報酬計算 snapshot を保存する
--   2) reward.calculate Proposal が executed になった時に
--      PATH payload から member 単位 snapshot を自動保存する
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reward_calculation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  calculation_system text NOT NULL,
  calculation_version text NOT NULL,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_by jsonb,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_id, member_id)
);

CREATE INDEX IF NOT EXISTS reward_calc_snapshots_org_month_idx
  ON public.reward_calculation_snapshots (org_id, month, finalized_at DESC);

CREATE INDEX IF NOT EXISTS reward_calc_snapshots_member_idx
  ON public.reward_calculation_snapshots (org_id, member_id, finalized_at DESC);

CREATE INDEX IF NOT EXISTS reward_calc_snapshots_proposal_idx
  ON public.reward_calculation_snapshots (proposal_id);

ALTER TABLE public.reward_calculation_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_calculation_snapshots" ON public.reward_calculation_snapshots;
CREATE POLICY "Read reward_calculation_snapshots"
ON public.reward_calculation_snapshots
FOR SELECT TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.capture_path_reward_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calculation_system text;
  v_calculation_version text;
  v_month text;
  v_member jsonb;
  v_profit_inputs jsonb;
  v_constant_snapshot jsonb;
  v_policy_snapshot jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.type <> 'reward.calculate'
    OR NEW.status <> 'executed'
    OR COALESCE(OLD.status, '') = 'executed'
  THEN
    RETURN NEW;
  END IF;

  v_calculation_system := COALESCE(NEW.payload->>'calculation_system', '');
  IF v_calculation_system <> 'path_v2' THEN
    RETURN NEW;
  END IF;

  v_calculation_version := COALESCE(NULLIF(NEW.payload->>'calculation_version', ''), 'path_v2');
  v_month := COALESCE(
    NULLIF(NEW.payload->>'month', ''),
    TO_CHAR(COALESCE(NEW.executed_at, now()), 'YYYY-MM')
  );
  v_profit_inputs := COALESCE(NEW.payload->'profit_inputs', '{}'::jsonb);
  v_constant_snapshot := COALESCE(NEW.payload->'constant_snapshot', '{}'::jsonb);
  v_policy_snapshot := jsonb_build_object(
    'policy_ref', NEW.policy_ref,
    'required_approvals', NEW.required_approvals,
    'approvals', COALESCE(NEW.approvals, '[]'::jsonb)
  );

  DELETE FROM public.reward_calculation_snapshots
  WHERE org_id = NEW.org_id
    AND proposal_id = NEW.id;

  FOR v_member IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(NEW.payload->'members', '[]'::jsonb))
  LOOP
    IF COALESCE(v_member->>'member_id', '') !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.reward_calculation_snapshots (
      org_id,
      month,
      proposal_id,
      member_id,
      calculation_system,
      calculation_version,
      input_snapshot,
      result_snapshot,
      policy_snapshot,
      executed_by,
      finalized_at
    ) VALUES (
      NEW.org_id,
      v_month,
      NEW.id,
      (v_member->>'member_id')::uuid,
      v_calculation_system,
      v_calculation_version,
      jsonb_build_object(
        'month', v_month,
        'member_id', v_member->>'member_id',
        'name', v_member->>'name',
        'work_days', COALESCE((v_member->>'work_days')::integer, 0),
        'level', v_member->>'level',
        'A', COALESCE((v_member->>'A')::integer, 0),
        'R', COALESCE((v_member->>'R')::integer, 0),
        'Q', COALESCE((v_member->>'Q')::integer, 0),
        'profit_inputs_snapshot', v_profit_inputs,
        'constant_snapshot', v_constant_snapshot
      ),
      jsonb_build_object(
        'profit_amount', COALESCE((NEW.payload->>'profit_amount')::numeric, 0),
        'base_pool_amount', COALESCE((NEW.payload->>'base_pool_amount')::numeric, 0),
        'variable_pool_amount', COALESCE((NEW.payload->>'variable_pool_amount')::numeric, 0),
        'level_coefficient', COALESCE((v_member->>'level_coefficient')::numeric, 0),
        'base_weight', COALESCE((v_member->>'base_weight')::numeric, 0),
        'monthly_point_total', COALESCE((v_member->>'monthly_point_total')::integer, 0),
        'monthly_coefficient', COALESCE((v_member->>'monthly_coefficient')::numeric, 0),
        'base_reward', COALESCE((v_member->>'base_reward')::numeric, 0),
        'variable_reward', COALESCE((v_member->>'variable_reward')::numeric, 0),
        'total_reward', COALESCE((v_member->>'total_reward')::numeric, 0)
      ),
      v_policy_snapshot,
      NEW.executed_by,
      COALESCE(NEW.executed_at, now())
    )
    ON CONFLICT (org_id, proposal_id, member_id) DO UPDATE
      SET month = EXCLUDED.month,
          calculation_system = EXCLUDED.calculation_system,
          calculation_version = EXCLUDED.calculation_version,
          input_snapshot = EXCLUDED.input_snapshot,
          result_snapshot = EXCLUDED.result_snapshot,
          policy_snapshot = EXCLUDED.policy_snapshot,
          executed_by = EXCLUDED.executed_by,
          finalized_at = EXCLUDED.finalized_at;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_path_reward_snapshot_trigger ON public.proposals;
CREATE TRIGGER proposals_path_reward_snapshot_trigger
AFTER UPDATE ON public.proposals
FOR EACH ROW
EXECUTE FUNCTION public.capture_path_reward_snapshot();
