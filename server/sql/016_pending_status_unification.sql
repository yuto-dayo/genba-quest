-- ============================================================
-- pending status unification (proposed -> pending)
-- ============================================================
-- 目的:
-- 1) proposals.status の承認待ち表現を pending に統一
-- 2) 既存データ proposed を pending に移行
-- 3) approve/reject 原子関数の待機状態チェックを pending に統一
-- ============================================================

-- 1. status 制約を pending ベースに置き換え
ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_status_check;

UPDATE public.proposals
SET status = 'pending'
WHERE status = 'proposed';

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'executed'));

COMMENT ON COLUMN public.proposals.status IS
  'ライフサイクルステータス: draft→pending→approved→executed / rejected';

-- 2. approve_proposal_atomic を pending 状態判定に更新
DROP FUNCTION IF EXISTS public.approve_proposal_atomic(uuid, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.approve_proposal_atomic(
  p_org_id uuid,
  p_proposal_id uuid,
  p_approver jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_approver_type text;
  v_creator_type text;
  v_approval_count integer;
  v_new_approval jsonb;
  v_updated_approvals jsonb;
  v_is_fully_approved boolean;
  v_auto_executed boolean := false;
  v_execute_result jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  IF v_proposal.status != 'pending' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_IN_PENDING_STATE';
  END IF;

  v_approver_type := p_approver->>'type';
  v_creator_type := v_proposal.created_by->>'type';

  IF v_creator_type = 'ai' AND v_approver_type = 'ai' THEN
    RAISE EXCEPTION 'AI_SELF_APPROVAL_PROHIBITED';
  END IF;

  IF v_approver_type = 'integration' THEN
    RAISE EXCEPTION 'INTEGRATION_APPROVAL_PROHIBITED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
    WHERE elem->'actor'->>'id' = p_approver->>'id'
      AND elem->>'decision' = 'approve'
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED_BY_THIS_ACTOR';
  END IF;

  SELECT count(*)::integer INTO v_approval_count
  FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
  WHERE elem->>'decision' = 'approve';

  IF v_proposal.required_approvals > 0 AND v_approval_count >= v_proposal.required_approvals THEN
    RAISE EXCEPTION 'APPROVAL_COUNT_ALREADY_MET';
  END IF;

  v_new_approval := jsonb_build_object(
    'actor', p_approver,
    'decision', 'approve',
    'reason', p_reason,
    'at', v_now::text
  );
  v_updated_approvals := COALESCE(v_proposal.approvals, '[]'::jsonb) || v_new_approval;

  v_approval_count := v_approval_count + 1;
  v_is_fully_approved := (v_approval_count >= v_proposal.required_approvals);

  IF v_is_fully_approved THEN
    UPDATE proposals
    SET status = 'approved',
        approvals = v_updated_approvals,
        updated_at = v_now
    WHERE id = p_proposal_id
      AND org_id = p_org_id
    RETURNING * INTO v_proposal;

    BEGIN
      v_execute_result := public.execute_proposal_atomic(
        p_org_id,
        p_proposal_id,
        jsonb_build_object('type', 'system', 'id', 'system', 'name', 'System Auto-Execute')
      );

      SELECT * INTO v_proposal
      FROM proposals
      WHERE id = p_proposal_id
        AND org_id = p_org_id;

      v_auto_executed := true;
    EXCEPTION
      WHEN OTHERS THEN
        v_auto_executed := false;
    END;
  ELSE
    UPDATE proposals
    SET approvals = v_updated_approvals,
        updated_at = v_now
    WHERE id = p_proposal_id
      AND org_id = p_org_id
    RETURNING * INTO v_proposal;
  END IF;

  RETURN jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'is_fully_approved', v_is_fully_approved,
    'auto_executed', v_auto_executed
  );
END;
$$;

COMMENT ON FUNCTION public.approve_proposal_atomic IS
  '承認+実行を原子的に実行: pending承認待ち + AI自己承認禁止 + 承認追加 + (条件充足時)Event作成+仕訳+ステータス更新';

-- 3. reject_proposal_atomic を pending 状態判定に更新
DROP FUNCTION IF EXISTS public.reject_proposal_atomic(uuid, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.reject_proposal_atomic(
  p_org_id uuid,
  p_proposal_id uuid,
  p_rejector jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_new_rejection jsonb;
  v_updated_approvals jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  IF v_proposal.status != 'pending' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_IN_PENDING_STATE';
  END IF;

  v_new_rejection := jsonb_build_object(
    'actor', p_rejector,
    'decision', 'reject',
    'reason', p_reason,
    'at', v_now::text
  );
  v_updated_approvals := COALESCE(v_proposal.approvals, '[]'::jsonb) || v_new_rejection;

  UPDATE proposals
  SET status = 'rejected',
      approvals = v_updated_approvals,
      rejection_reason = p_reason,
      updated_at = v_now
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  RETURNING * INTO v_proposal;

  RETURN to_jsonb(v_proposal);
END;
$$;

COMMENT ON FUNCTION public.reject_proposal_atomic IS
  'Proposal却下を原子的に実行: pending承認待ちに対する却下履歴追加 + status更新を1トランザクションで実行';
