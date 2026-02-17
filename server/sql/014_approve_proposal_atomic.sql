-- ============================================================
-- approve_proposal_atomic: 承認 + (条件充足時)実行を1トランザクションで
-- ============================================================
-- DAO設計原則: 承認 + Event発行 + 状態更新 = 1つのDBトランザクション
-- AI自己承認禁止ゲートを含む
--
-- 戻り値: { proposal, is_fully_approved, auto_executed }
-- ============================================================

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
  -- 1. Proposalを取得（FOR UPDATEでロック — レースコンディション防止）
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

  -- 2. AI自己承認禁止チェック（絶対ゲート）
  v_approver_type := p_approver->>'type';
  v_creator_type := v_proposal.created_by->>'type';

  IF v_creator_type = 'ai' AND v_approver_type = 'ai' THEN
    RAISE EXCEPTION 'AI_SELF_APPROVAL_PROHIBITED';
  END IF;

  -- integration は承認不可
  IF v_approver_type = 'integration' THEN
    RAISE EXCEPTION 'INTEGRATION_APPROVAL_PROHIBITED';
  END IF;

  -- 3. 重複承認チェック
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
    WHERE elem->'actor'->>'id' = p_approver->>'id'
      AND elem->>'decision' = 'approve'
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED_BY_THIS_ACTOR';
  END IF;

  -- 4. 現在の承認数を確認
  SELECT count(*)::integer INTO v_approval_count
  FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
  WHERE elem->>'decision' = 'approve';

  IF v_proposal.required_approvals > 0 AND v_approval_count >= v_proposal.required_approvals THEN
    RAISE EXCEPTION 'APPROVAL_COUNT_ALREADY_MET';
  END IF;

  -- 5. 承認を追加
  v_new_approval := jsonb_build_object(
    'actor', p_approver,
    'decision', 'approve',
    'reason', p_reason,
    'at', v_now::text
  );
  v_updated_approvals := COALESCE(v_proposal.approvals, '[]'::jsonb) || v_new_approval;

  -- 6. 必要承認数に達したかチェック
  v_approval_count := v_approval_count + 1;
  v_is_fully_approved := (v_approval_count >= v_proposal.required_approvals);

  -- 7. Proposalステータスを更新
  IF v_is_fully_approved THEN
    UPDATE proposals
    SET status = 'approved',
        approvals = v_updated_approvals,
        updated_at = v_now
    WHERE id = p_proposal_id
      AND org_id = p_org_id
    RETURNING * INTO v_proposal;

    -- 8. 最終承認時は即時実行（同一トランザクション内）
    -- execute失敗時は承認を維持し、auto_executed=false で返す
    BEGIN
      v_execute_result := public.execute_proposal_atomic(
        p_org_id,
        p_proposal_id,
        jsonb_build_object('type', 'system', 'id', 'system', 'name', 'System Auto-Execute')
      );

      -- execute結果からproposalを復元
      SELECT * INTO v_proposal
      FROM proposals
      WHERE id = p_proposal_id
        AND org_id = p_org_id;

      v_auto_executed := true;
    EXCEPTION
      WHEN OTHERS THEN
        -- 承認は成功扱いにし、executeのみ失敗として扱う
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

  -- 9. 結果を返す
  RETURN jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'is_fully_approved', v_is_fully_approved,
    'auto_executed', v_auto_executed
  );
END;
$$;

COMMENT ON FUNCTION public.approve_proposal_atomic IS
  '承認+実行を原子的に実行: AI自己承認禁止 + 承認追加 + (条件充足時)Event作成+仕訳+ステータス更新を1トランザクションで';
