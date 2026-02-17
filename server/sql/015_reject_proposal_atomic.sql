-- ============================================================
-- reject_proposal_atomic: 却下を1トランザクションで原子実行
-- ============================================================
-- DAO設計原則: 状態更新はProposal経由で記録し、競合を防ぐ
-- 参照: docs/DESIGN_PHILOSOPHY.md
--
-- 戻り値: 却下後のproposalレコード（jsonb）
-- ============================================================

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
  -- 1. Proposalを取得（FOR UPDATEでロック）
  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  IF v_proposal.status != 'proposed' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_IN_PROPOSED_STATE';
  END IF;

  -- 2. 却下履歴を追加
  v_new_rejection := jsonb_build_object(
    'actor', p_rejector,
    'decision', 'reject',
    'reason', p_reason,
    'at', v_now::text
  );
  v_updated_approvals := COALESCE(v_proposal.approvals, '[]'::jsonb) || v_new_rejection;

  -- 3. 却下状態へ更新
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
  'Proposal却下を原子的に実行: 却下履歴追加 + status更新を1トランザクションで実行';
