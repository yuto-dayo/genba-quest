-- ============================================================
-- 052: Site completion RPC and income auto generation
-- ============================================================
-- 目的:
--   1) site complete -> completion event -> revenue_basis -> income.create を原子的に束ねる
--   2) site completion reversal -> income.reverse / reward.adjust proposal autogen を束ねる
--   3) route 層から direct update を剥がせる DB command layer を追加する
-- メモ:
--   - auto-generated proposals は system actor / required_approvals=0 / approved で作成する
--   - auto execute はまだ行わない。proposal execution は app/service 層から呼ぶ
--   - next open period 算定は未freezeのため recorded_date は RPC 実行日を使う
-- ============================================================

DROP FUNCTION IF EXISTS public.complete_site_rpc(uuid, uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.reverse_site_completion_rpc(uuid, uuid, uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.find_proposal_id_by_idempotency_key(uuid, text);

CREATE OR REPLACE FUNCTION public.find_proposal_id_by_idempotency_key(
  p_org_id uuid,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal_id uuid;
BEGIN
  SELECT id
  INTO v_proposal_id
  FROM public.proposals
  WHERE org_id = p_org_id
    AND idempotency_key = p_idempotency_key
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_proposal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_site_rpc(
  p_org_id uuid,
  p_site_id uuid,
  p_actor_user_id uuid,
  p_effective_completed_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_site public.sites%ROWTYPE;
  v_effective_completed_at timestamptz := COALESCE(p_effective_completed_at, now());
  v_existing_event_id uuid;
  v_existing_revenue_basis_id uuid;
  v_existing_income_proposal_id uuid;
  v_next_sequence_no integer;
  v_event_id uuid;
  v_revenue_basis_id uuid;
  v_income_proposal_id uuid;
  v_income_idempotency_key text;
  v_amount numeric(15, 2);
  v_description text;
  v_system_actor jsonb := jsonb_build_object(
    'type', 'system',
    'id', 'system:site_completion_rpc',
    'name', 'System Site Completion RPC'
  );
BEGIN
  SELECT *
  INTO v_site
  FROM public.sites
  WHERE id = p_site_id
    AND org_id = p_org_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND';
  END IF;

  v_amount := ROUND(COALESCE(v_site.revenue, 0)::numeric, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME';
  END IF;

  SELECT sce.id, rb.id
  INTO v_existing_event_id, v_existing_revenue_basis_id
  FROM public.site_completion_events AS sce
  JOIN public.revenue_basis AS rb
    ON rb.origin_completion_event_id = sce.id
   AND rb.org_id = p_org_id
   AND rb.status = 'active'
  WHERE sce.org_id = p_org_id
    AND sce.site_id = p_site_id
    AND sce.event_type = 'recorded'
    AND NOT EXISTS (
      SELECT 1
      FROM public.site_completion_events AS reversed
      WHERE reversed.reversed_event_id = sce.id
    )
  ORDER BY sce.sequence_no DESC
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    v_existing_income_proposal_id := public.find_proposal_id_by_idempotency_key(
      p_org_id,
      format('income:auto:site_completion_event:%s', v_existing_event_id)
    );

    IF v_site.status = 'completed' THEN
      RETURN jsonb_build_object(
        'site_id', p_site_id,
        'site_completion_event_id', v_existing_event_id,
        'revenue_basis_id', v_existing_revenue_basis_id,
        'income_proposal_id', v_existing_income_proposal_id,
        'idempotent', true
      );
    END IF;

    RAISE EXCEPTION 'SITE_COMPLETION_ALREADY_ACTIVE';
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0) + 1
  INTO v_next_sequence_no
  FROM public.site_completion_events
  WHERE site_id = p_site_id;

  UPDATE public.sites
  SET status = 'completed',
      completed_at = v_effective_completed_at
  WHERE id = p_site_id;

  INSERT INTO public.site_completion_events (
    org_id,
    site_id,
    sequence_no,
    event_type,
    effective_completed_at,
    actor_user_id,
    idempotency_key
  )
  VALUES (
    p_org_id,
    p_site_id,
    v_next_sequence_no,
    'recorded',
    v_effective_completed_at,
    p_actor_user_id,
    format('site:completion:recorded:%s:%s', p_site_id, v_next_sequence_no)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.revenue_basis (
    org_id,
    site_id,
    origin_completion_event_id,
    status,
    recognition_date,
    currency,
    metadata_json
  )
  VALUES (
    p_org_id,
    p_site_id,
    v_event_id,
    'active',
    v_effective_completed_at::date,
    'JPY',
    jsonb_build_object(
      'site_completion_event_id', v_event_id,
      'site_status', 'completed',
      'source', 'complete_site_rpc'
    )
  )
  RETURNING id INTO v_revenue_basis_id;

  v_income_idempotency_key := format('income:auto:site_completion_event:%s', v_event_id);
  v_income_proposal_id := public.find_proposal_id_by_idempotency_key(p_org_id, v_income_idempotency_key);

  IF v_income_proposal_id IS NULL THEN
    v_description := COALESCE(v_site.name, 'site') || ' 売上計上';

    INSERT INTO public.proposals (
      org_id,
      type,
      status,
      site_id,
      revenue_basis_id,
      created_by,
      payload,
      description,
      policy_ref,
      approvals,
      required_approvals,
      idempotency_key
    )
    VALUES (
      p_org_id,
      'income.create',
      'approved',
      p_site_id,
      v_revenue_basis_id,
      v_system_actor,
      jsonb_build_object(
        'amount', v_amount,
        'currency', 'JPY',
        'recorded_date', v_effective_completed_at::date,
        'recognition_date', v_effective_completed_at::date,
        'description', v_description,
        'site_id', p_site_id,
        'revenue_basis_id', v_revenue_basis_id,
        'site_completion_event_id', v_event_id,
        'source', 'complete_site_rpc'
      ),
      v_description,
      'system.auto_income_from_site_completion',
      '[]'::jsonb,
      0,
      v_income_idempotency_key
    )
    RETURNING id INTO v_income_proposal_id;
  END IF;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'site_completion_event_id', v_event_id,
    'revenue_basis_id', v_revenue_basis_id,
    'income_proposal_id', v_income_proposal_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_site_completion_rpc(
  p_org_id uuid,
  p_site_id uuid,
  p_actor_user_id uuid,
  p_effective_reversed_at timestamptz DEFAULT now(),
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_site public.sites%ROWTYPE;
  v_effective_reversed_at timestamptz := COALESCE(p_effective_reversed_at, now());
  v_active_recorded_event_id uuid;
  v_active_revenue_basis_id uuid;
  v_recorded_effective_completed_at timestamptz;
  v_latest_reversed_event_id uuid;
  v_latest_reversed_revenue_basis_id uuid;
  v_latest_income_reverse_proposal_id uuid;
  v_latest_reward_adjust_proposal_id uuid;
  v_next_sequence_no integer;
  v_reversal_event_id uuid;
  v_income_create_proposal public.proposals%ROWTYPE;
  v_income_reverse_proposal_id uuid;
  v_income_reverse_idempotency_key text;
  v_month_close_id uuid;
  v_reward_adjust_proposal_id uuid;
  v_reward_adjust_idempotency_key text;
  v_system_actor jsonb := jsonb_build_object(
    'type', 'system',
    'id', 'system:site_completion_rpc',
    'name', 'System Site Completion RPC'
  );
  v_income_amount numeric(15, 2);
  v_site_name text;
BEGIN
  SELECT *
  INTO v_site
  FROM public.sites
  WHERE id = p_site_id
    AND org_id = p_org_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND';
  END IF;

  v_site_name := COALESCE(v_site.name, 'site');

  SELECT sce.id, rb.id, sce.effective_completed_at
  INTO v_active_recorded_event_id, v_active_revenue_basis_id, v_recorded_effective_completed_at
  FROM public.site_completion_events AS sce
  JOIN public.revenue_basis AS rb
    ON rb.origin_completion_event_id = sce.id
   AND rb.org_id = p_org_id
   AND rb.status = 'active'
  WHERE sce.org_id = p_org_id
    AND sce.site_id = p_site_id
    AND sce.event_type = 'recorded'
    AND NOT EXISTS (
      SELECT 1
      FROM public.site_completion_events AS reversed
      WHERE reversed.reversed_event_id = sce.id
    )
  ORDER BY sce.sequence_no DESC
  LIMIT 1;

  IF v_active_recorded_event_id IS NULL THEN
    IF v_site.status = 'completion_reversed' THEN
      SELECT sce.id
      INTO v_latest_reversed_event_id
      FROM public.site_completion_events AS sce
      WHERE sce.org_id = p_org_id
        AND sce.site_id = p_site_id
        AND sce.event_type = 'reversed'
      ORDER BY sce.sequence_no DESC
      LIMIT 1;

      IF v_latest_reversed_event_id IS NOT NULL THEN
        SELECT rb.id
        INTO v_latest_reversed_revenue_basis_id
        FROM public.revenue_basis AS rb
        WHERE rb.org_id = p_org_id
          AND rb.reversed_by_event_id = v_latest_reversed_event_id
        ORDER BY rb.created_at DESC
        LIMIT 1;

        v_latest_income_reverse_proposal_id := public.find_proposal_id_by_idempotency_key(
          p_org_id,
          format('income:reverse:site_completion_reversal:%s', v_latest_reversed_event_id)
        );

        SELECT p.id
        INTO v_latest_reward_adjust_proposal_id
        FROM public.proposals AS p
        WHERE p.org_id = p_org_id
          AND p.type = 'reward.adjust'
          AND p.idempotency_key LIKE format('reward:adjust:site_completion_reversal:%s:%%', v_latest_reversed_event_id)
        ORDER BY p.created_at DESC
        LIMIT 1;

        RETURN jsonb_build_object(
          'site_id', p_site_id,
          'reversal_event_id', v_latest_reversed_event_id,
          'revenue_basis_id', v_latest_reversed_revenue_basis_id,
          'income_reverse_proposal_id', v_latest_income_reverse_proposal_id,
          'reward_adjust_proposal_id', v_latest_reward_adjust_proposal_id,
          'idempotent', true
        );
      END IF;
    END IF;

    RAISE EXCEPTION 'SITE_COMPLETION_NOT_ACTIVE';
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0) + 1
  INTO v_next_sequence_no
  FROM public.site_completion_events
  WHERE site_id = p_site_id;

  UPDATE public.sites
  SET status = 'completion_reversed',
      completed_at = NULL
  WHERE id = p_site_id;

  INSERT INTO public.site_completion_events (
    org_id,
    site_id,
    sequence_no,
    event_type,
    effective_completed_at,
    reversed_event_id,
    actor_user_id,
    idempotency_key
  )
  VALUES (
    p_org_id,
    p_site_id,
    v_next_sequence_no,
    'reversed',
    v_effective_reversed_at,
    v_active_recorded_event_id,
    p_actor_user_id,
    format('site:completion:reversed:%s:%s', p_site_id, v_active_recorded_event_id)
  )
  RETURNING id INTO v_reversal_event_id;

  UPDATE public.revenue_basis
  SET status = 'reversed',
      reversed_by_event_id = v_reversal_event_id
  WHERE id = v_active_revenue_basis_id;

  SELECT *
  INTO v_income_create_proposal
  FROM public.proposals
  WHERE org_id = p_org_id
    AND revenue_basis_id = v_active_revenue_basis_id
    AND type = 'income.create'
  ORDER BY created_at DESC
  LIMIT 1;

  v_income_amount := ROUND(
    COALESCE(
      NULLIF(v_income_create_proposal.payload->>'amount', '')::numeric,
      NULLIF(v_income_create_proposal.payload->>'amount_total', '')::numeric,
      v_site.revenue,
      0
    )::numeric,
    2
  );

  IF v_income_create_proposal.id IS NOT NULL THEN
    IF v_income_create_proposal.status IN ('draft', 'pending', 'approved') THEN
      UPDATE public.proposals
      SET status = 'canceled'
      WHERE id = v_income_create_proposal.id
        AND status IN ('draft', 'pending', 'approved');
    ELSIF v_income_create_proposal.status = 'executed' THEN
      v_income_reverse_idempotency_key := format(
        'income:reverse:site_completion_reversal:%s',
        v_reversal_event_id
      );
      v_income_reverse_proposal_id := public.find_proposal_id_by_idempotency_key(
        p_org_id,
        v_income_reverse_idempotency_key
      );

      IF v_income_reverse_proposal_id IS NULL THEN
        INSERT INTO public.proposals (
          org_id,
          type,
          status,
          site_id,
          revenue_basis_id,
          created_by,
          payload,
          description,
          policy_ref,
          approvals,
          required_approvals,
          idempotency_key,
          supersedes_proposal_id
        )
        VALUES (
          p_org_id,
          'income.reverse',
          'approved',
          p_site_id,
          v_active_revenue_basis_id,
          v_system_actor,
          jsonb_build_object(
            'amount', v_income_amount,
            'currency', 'JPY',
            'recorded_date', v_effective_reversed_at::date,
            'recognition_date', v_recorded_effective_completed_at::date,
            'description', v_site_name || ' 売上取消',
            'site_id', p_site_id,
            'revenue_basis_id', v_active_revenue_basis_id,
            'site_completion_reversal_event_id', v_reversal_event_id,
            'reverses_proposal_id', v_income_create_proposal.id,
            'reason', p_reason,
            'source', 'reverse_site_completion_rpc'
          ),
          v_site_name || ' 売上取消',
          'system.auto_income_reverse_from_site_completion',
          '[]'::jsonb,
          0,
          v_income_reverse_idempotency_key,
          v_income_create_proposal.id
        )
        RETURNING id INTO v_income_reverse_proposal_id;
      END IF;
    END IF;
  END IF;

  SELECT mcl.month_close_id
  INTO v_month_close_id
  FROM public.month_close_lines AS mcl
  JOIN public.month_closes AS mc
    ON mc.id = mcl.month_close_id
  WHERE mcl.revenue_basis_id = v_active_revenue_basis_id
    AND mc.org_id = p_org_id
    AND mc.status = 'fixed'
  ORDER BY mc.fixed_at DESC NULLS LAST, mc.created_at DESC
  LIMIT 1;

  IF v_month_close_id IS NOT NULL THEN
    v_reward_adjust_idempotency_key := format(
      'reward:adjust:site_completion_reversal:%s:close:%s',
      v_reversal_event_id,
      v_month_close_id
    );
    v_reward_adjust_proposal_id := public.find_proposal_id_by_idempotency_key(
      p_org_id,
      v_reward_adjust_idempotency_key
    );

    IF v_reward_adjust_proposal_id IS NULL THEN
      INSERT INTO public.proposals (
        org_id,
        type,
        status,
        site_id,
        revenue_basis_id,
        month_close_id,
        calculation_system,
        created_by,
        payload,
        description,
        policy_ref,
        approvals,
        required_approvals,
        idempotency_key
      )
      VALUES (
        p_org_id,
        'reward.adjust',
        'approved',
        p_site_id,
        v_active_revenue_basis_id,
        v_month_close_id,
        'path_v22',
        v_system_actor,
        jsonb_build_object(
          'month_close_id', v_month_close_id,
          'revenue_basis_id', v_active_revenue_basis_id,
          'calculation_system', 'path_v22',
          'run_type', 'adjustment',
          'site_id', p_site_id,
          'site_completion_reversal_event_id', v_reversal_event_id,
          'reason_code', 'site_completion_reversed',
          'reason', p_reason,
          'source', 'reverse_site_completion_rpc'
        ),
        v_site_name || ' 報酬調整',
        'system.auto_reward_adjust_from_site_completion',
        '[]'::jsonb,
        0,
        v_reward_adjust_idempotency_key
      )
      RETURNING id INTO v_reward_adjust_proposal_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'reversal_event_id', v_reversal_event_id,
    'revenue_basis_id', v_active_revenue_basis_id,
    'income_reverse_proposal_id', v_income_reverse_proposal_id,
    'reward_adjust_proposal_id', v_reward_adjust_proposal_id,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.find_proposal_id_by_idempotency_key(uuid, text) IS
  'Returns a proposal id for a stable idempotency key within an org.';

COMMENT ON FUNCTION public.complete_site_rpc(uuid, uuid, uuid, timestamptz) IS
  'Atomically records site completion fact, creates revenue_basis, and auto-generates an approved income.create proposal.';

COMMENT ON FUNCTION public.reverse_site_completion_rpc(uuid, uuid, uuid, timestamptz, text) IS
  'Atomically records site completion reversal, reverses revenue_basis, and auto-generates income.reverse / reward.adjust proposals when needed.';
