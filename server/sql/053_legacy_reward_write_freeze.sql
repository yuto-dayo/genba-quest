-- ============================================================
-- 053: Legacy reward write freeze
-- ============================================================
-- 目的:
--   1) legacy reward write path を DB 定義上 read-only に固定する
--   2) canonical reward write は path_v22 のみ許可する guard を追加する
--   3) route/service から共通に参照できる guard table / view / function を用意する
-- メモ:
--   - path_reward_runs への projection write は互換期間のため直接は止めない
--   - 実際の route reject は app 層差し替えで行い、DB では共通判定 primitive を提供する
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reward_write_controls (
  org_id uuid NOT NULL,
  control_key text NOT NULL CHECK (control_key IN (
    'legacy_reward_write',
    'canonical_reward_system'
  )),
  control_mode text NOT NULL CHECK (control_mode IN (
    'blocked',
    'allow',
    'path_v22_only'
  )),
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, control_key)
);

CREATE INDEX IF NOT EXISTS reward_write_controls_org_mode_idx
  ON public.reward_write_controls (org_id, control_mode, updated_at DESC);

ALTER TABLE public.reward_write_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_write_controls" ON public.reward_write_controls;
DROP POLICY IF EXISTS "Manage reward_write_controls" ON public.reward_write_controls;

CREATE POLICY "Read reward_write_controls"
ON public.reward_write_controls
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Manage reward_write_controls"
ON public.reward_write_controls
FOR ALL TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
  )
)
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
  )
);

DROP TRIGGER IF EXISTS reward_write_controls_set_updated_at ON public.reward_write_controls;
CREATE TRIGGER reward_write_controls_set_updated_at
BEFORE UPDATE ON public.reward_write_controls
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.reward_write_controls (org_id, control_key, control_mode, config_json)
VALUES
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'legacy_reward_write',
    'blocked',
    jsonb_build_object(
      'http_status', 410,
      'message', 'Legacy reward write path is frozen. Use PATH v2 canonical routes.'
    )
  ),
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'canonical_reward_system',
    'path_v22_only',
    jsonb_build_object(
      'required_calculation_system', 'path_v22'
    )
  )
ON CONFLICT (org_id, control_key) DO UPDATE
SET control_mode = EXCLUDED.control_mode,
    config_json = EXCLUDED.config_json;

CREATE OR REPLACE VIEW public.reward_write_guard_status AS
SELECT
  org_id,
  MAX(control_mode) FILTER (WHERE control_key = 'legacy_reward_write') AS legacy_reward_write_mode,
  MAX(control_mode) FILTER (WHERE control_key = 'canonical_reward_system') AS canonical_reward_system_mode,
  (MAX(config_json::text) FILTER (WHERE control_key = 'legacy_reward_write'))::jsonb AS legacy_reward_write_config,
  (MAX(config_json::text) FILTER (WHERE control_key = 'canonical_reward_system'))::jsonb AS canonical_reward_system_config,
  MAX(updated_at) AS updated_at
FROM public.reward_write_controls
GROUP BY org_id;

CREATE OR REPLACE FUNCTION public.assert_reward_write_allowed(
  p_org_id uuid,
  p_route_key text,
  p_proposal_type text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_legacy_mode text := 'blocked';
  v_legacy_config jsonb := jsonb_build_object(
    'http_status', 410,
    'message', 'Legacy reward write path is frozen. Use PATH v2 canonical routes.'
  );
  v_canonical_mode text := 'path_v22_only';
  v_canonical_config jsonb := jsonb_build_object(
    'required_calculation_system', 'path_v22'
  );
  v_calculation_system text := COALESCE(NULLIF(p_payload->>'calculation_system', ''), '');
  v_month_close_id text := COALESCE(NULLIF(p_payload->>'month_close_id', ''), '');
BEGIN
  SELECT control_mode, config_json
  INTO v_legacy_mode, v_legacy_config
  FROM public.reward_write_controls
  WHERE org_id = p_org_id
    AND control_key = 'legacy_reward_write';

  IF NOT FOUND THEN
    v_legacy_mode := 'blocked';
    v_legacy_config := jsonb_build_object(
      'http_status', 410,
      'message', 'Legacy reward write path is frozen. Use PATH v2 canonical routes.'
    );
  END IF;

  SELECT control_mode, config_json
  INTO v_canonical_mode, v_canonical_config
  FROM public.reward_write_controls
  WHERE org_id = p_org_id
    AND control_key = 'canonical_reward_system';

  IF NOT FOUND THEN
    v_canonical_mode := 'path_v22_only';
    v_canonical_config := jsonb_build_object(
      'required_calculation_system', 'path_v22'
    );
  END IF;

  IF p_route_key IN (
    'pathRewards.proposals',
    'pathRewards.execute',
    'legacy_reward_write'
  ) AND v_legacy_mode = 'blocked' THEN
    RAISE EXCEPTION 'LEGACY_REWARD_WRITE_FROZEN';
  END IF;

  IF p_proposal_type IN ('reward.calculate', 'reward.adjust')
     AND v_canonical_mode = 'path_v22_only'
     AND v_calculation_system <> COALESCE(v_canonical_config->>'required_calculation_system', 'path_v22')
  THEN
    RAISE EXCEPTION 'REWARD_WRITE_REQUIRES_PATH_V22';
  END IF;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'route_key', p_route_key,
    'proposal_type', p_proposal_type,
    'legacy_reward_write_mode', v_legacy_mode,
    'canonical_reward_system_mode', v_canonical_mode,
    'calculation_system', NULLIF(v_calculation_system, ''),
    'month_close_id', NULLIF(v_month_close_id, ''),
    'allowed', true
  );
END;
$$;

COMMENT ON TABLE public.reward_write_controls IS
  'Org-scoped freeze controls for reward write paths. Used by route/service guards before canonical hard guards are enforced.';

COMMENT ON VIEW public.reward_write_guard_status IS
  'Pivoted view of reward write freeze settings by org.';

COMMENT ON FUNCTION public.assert_reward_write_allowed(uuid, text, text, jsonb) IS
  'Shared guard for reward write routes. Rejects legacy write paths and requires path_v22 for canonical reward proposals.';
