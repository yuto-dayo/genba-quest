-- ============================================================
-- Add leave.request Proposal type + execute_proposal_atomic 拡張
-- ============================================================
-- 目的:
--   1) proposals.type に leave.request を追加
--   2) execute_proposal_atomic で leave.request の副作用
--      (personal_schedules への approved 登録) を原子実行
--
-- 適用順:
--   013 -> 014 -> 015 -> 016 -> 017 -> 019 -> 020
-- ============================================================

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_type_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_type_check
  CHECK (type IN (
    -- 経費・売上
    'expense.create',
    'expense.update',
    'expense.void',
    'income.create',
    'income.update',
    -- 請求
    'invoice.create',
    'invoice.send',
    'invoice.mark_paid',
    -- 報酬
    'reward.calculate',
    'reward.adjust',
    -- スキル・評価
    'skill.achieve',
    'skill.revoke',
    'evaluation.submit',
    'evaluation.finalize',
    -- アサイン
    'assignment.create',
    'assignment.update',
    'assignment.cancel',
    -- 休暇
    'leave.request',
    -- コミュニケーション
    'communication.review',
    'communication.task',
    'task.revision.request',
    -- 現場
    'site.create',
    'site.complete',
    -- ポリシー
    'policy.update'
  ));

DROP FUNCTION IF EXISTS public.execute_proposal_atomic(uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.execute_proposal_atomic(
  p_org_id uuid,
  p_proposal_id uuid,
  p_executor jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_event_id uuid;
  v_transaction_id uuid;
  v_event_type text;
  v_amount numeric(15, 2);
  v_description text;
  v_transaction_date date;
  v_currency text;
  v_category text;
  v_expense_account text;
  v_assignment_site_id uuid;
  v_assignment_worker_ids uuid[];
  v_leave_schedule_id uuid;
  v_leave_user_id uuid;
  v_leave_start_date date;
  v_leave_end_date date;
  v_leave_type text;
  v_leave_reason text;
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

  -- 冪等性: 既にexecutedならそのまま返す
  IF v_proposal.status = 'executed' THEN
    RETURN to_jsonb(v_proposal);
  END IF;

  IF v_proposal.status != 'approved' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_APPROVED';
  END IF;

  -- 承認数チェック
  IF v_proposal.required_approvals > 0 THEN
    DECLARE
      v_approval_count integer;
    BEGIN
      SELECT count(*)::integer INTO v_approval_count
      FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
      WHERE elem->>'decision' = 'approve';

      IF v_approval_count < v_proposal.required_approvals THEN
        RAISE EXCEPTION 'INSUFFICIENT_APPROVALS';
      END IF;
    END;
  END IF;

  -- 2. イベントタイプをマッピング
  v_event_type := CASE v_proposal.type
    WHEN 'expense.create' THEN 'expense_recorded'
    WHEN 'expense.update' THEN 'expense_recorded'
    WHEN 'expense.void'   THEN 'expense_voided'
    WHEN 'income.create'  THEN 'income_recorded'
    WHEN 'income.update'  THEN 'income_recorded'
    WHEN 'invoice.create' THEN 'invoice_issued'
    WHEN 'invoice.send'   THEN 'invoice_sent'
    WHEN 'invoice.mark_paid' THEN 'payment_received'
    WHEN 'reward.calculate'  THEN 'reward_calculated'
    WHEN 'reward.adjust'     THEN 'reward_adjusted'
    ELSE 'internal_transfer'
  END;

  -- 3. 既存LedgerEvent確認（冪等性）
  SELECT id INTO v_event_id
  FROM ledger_events
  WHERE proposal_id = p_proposal_id
    AND org_id = p_org_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- 4. LedgerEvent作成（なければ）
  IF v_event_id IS NULL THEN
    INSERT INTO ledger_events (org_id, event_type, proposal_id, payload, actor)
    VALUES (p_org_id, v_event_type, p_proposal_id, v_proposal.payload, p_executor)
    RETURNING id INTO v_event_id;
  END IF;

  -- 5. 金額を抽出
  v_amount := COALESCE(
    (v_proposal.payload->>'amount')::numeric,
    (v_proposal.payload->>'amount_total')::numeric,
    (v_proposal.payload->>'total_amount')::numeric,
    (v_proposal.payload->>'total')::numeric,
    0
  );

  -- 6. 仕訳生成（金額が正の場合のみ）
  IF v_amount > 0 THEN
    -- 既存トランザクション確認
    SELECT id INTO v_transaction_id
    FROM ledger_transactions
    WHERE event_id = v_event_id
      AND org_id = p_org_id
    LIMIT 1;

    IF v_transaction_id IS NULL THEN
      v_description := COALESCE(
        v_proposal.payload->>'description',
        v_proposal.payload->>'memo',
        v_proposal.description
      );
      v_transaction_date := COALESCE(
        (v_proposal.payload->>'recorded_date')::date,
        (v_proposal.payload->>'date')::date,
        (v_proposal.payload->>'transaction_date')::date,
        v_now::date
      );
      v_currency := UPPER(COALESCE(v_proposal.payload->>'currency', 'JPY'));

      INSERT INTO ledger_transactions (org_id, event_id, transaction_date, description, currency)
      VALUES (p_org_id, v_event_id, v_transaction_date, v_description, v_currency)
      RETURNING id INTO v_transaction_id;

      -- 仕訳明細を生成
      v_category := LOWER(COALESCE(v_proposal.payload->>'category', ''));
      v_expense_account := CASE v_category
        WHEN 'material'  THEN '5100'
        WHEN 'materials' THEN '5100'
        WHEN 'tool'      THEN '5200'
        WHEN 'tools'     THEN '5200'
        WHEN 'travel'    THEN '5300'
        WHEN 'transportation' THEN '5300'
        WHEN 'food'      THEN '5400'
        ELSE '5900'
      END;

      CASE v_event_type
        WHEN 'expense_recorded' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, v_expense_account, v_amount, 0, v_description, 1),
            (v_transaction_id, '1100', 0, v_amount, v_description, 2);

        WHEN 'expense_voided' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '1100', v_amount, 0, v_description, 1),
            (v_transaction_id, v_expense_account, 0, v_amount, v_description, 2);

        WHEN 'income_recorded', 'invoice_issued' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '1200', v_amount, 0, v_description, 1),
            (v_transaction_id, '4100', 0, v_amount, v_description, 2);

        WHEN 'payment_received' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '1100', v_amount, 0, v_description, 1),
            (v_transaction_id, '1200', 0, v_amount, v_description, 2);

        WHEN 'reward_calculated', 'reward_adjusted' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '5500', v_amount, 0, v_description, 1),
            (v_transaction_id, '2130', 0, v_amount, v_description, 2);

        ELSE
          -- internal_transfer: payload から勘定科目を取得
          DECLARE
            v_debit_account text := COALESCE(
              v_proposal.payload->>'debit_account_code',
              v_proposal.payload->>'debit_account'
            );
            v_credit_account text := COALESCE(
              v_proposal.payload->>'credit_account_code',
              v_proposal.payload->>'credit_account'
            );
          BEGIN
            IF v_debit_account IS NOT NULL AND v_credit_account IS NOT NULL THEN
              INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
              VALUES
                (v_transaction_id, v_debit_account, v_amount, 0, v_description, 1),
                (v_transaction_id, v_credit_account, 0, v_amount, v_description, 2);
            END IF;
          END;
      END CASE;
    END IF;
  END IF;

  -- 6.5 assignment.create のドメイン副作用
  IF v_proposal.type = 'assignment.create' THEN
    DECLARE
      v_site_candidate text;
    BEGIN
      v_site_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'site_id', ''),
        NULLIF(v_proposal.payload->>'siteId', ''),
        NULLIF(v_proposal.payload->>'target_site_id', '')
      );

      IF v_site_candidate IS NOT NULL
        AND v_site_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN
        v_assignment_site_id := v_site_candidate::uuid;
      ELSE
        v_assignment_site_id := NULL;
      END IF;

      SELECT ARRAY_AGG(DISTINCT worker_uuid) INTO v_assignment_worker_ids
      FROM (
        SELECT worker_id::uuid AS worker_uuid
        FROM (
          SELECT NULLIF(v_proposal.payload->>'worker_id', '') AS worker_id
          UNION ALL
          SELECT NULLIF(v_proposal.payload->>'workerId', '')
          UNION ALL
          SELECT NULLIF(v_proposal.payload->>'user_id', '')
          UNION ALL
          SELECT NULLIF(v_proposal.payload->>'userId', '')
          UNION ALL
          SELECT value
          FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'worker_ids', '[]'::jsonb))
          UNION ALL
          SELECT value
          FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'workerIds', '[]'::jsonb))
          UNION ALL
          SELECT value
          FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'user_ids', '[]'::jsonb))
          UNION ALL
          SELECT value
          FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'userIds', '[]'::jsonb))
          UNION ALL
          SELECT NULLIF(elem->>'worker_id', '')
          FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL
          SELECT NULLIF(elem->>'workerId', '')
          FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL
          SELECT NULLIF(elem->>'user_id', '')
          FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL
          SELECT NULLIF(elem->>'userId', '')
          FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
        ) AS raw_ids
        WHERE worker_id IS NOT NULL
          AND worker_id ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      ) AS valid_ids;

      IF v_assignment_site_id IS NOT NULL
        AND COALESCE(array_length(v_assignment_worker_ids, 1), 0) > 0
      THEN
        UPDATE sites AS s
        SET assigned_users = (
          SELECT ARRAY(
            SELECT DISTINCT assigned_user
            FROM unnest(
              COALESCE(s.assigned_users, ARRAY[]::uuid[]) || v_assignment_worker_ids
            ) AS assigned_user
          )
        )
        WHERE s.id = v_assignment_site_id;

        UPDATE profiles
        SET current_site_id = v_assignment_site_id
        WHERE id = ANY(v_assignment_worker_ids);
      END IF;
    END;
  END IF;

  -- 6.6 leave.request のドメイン副作用（personal_schedules を承認済みで反映）
  IF v_proposal.type = 'leave.request' THEN
    DECLARE
      v_leave_user_candidate text;
      v_leave_start_candidate text;
      v_leave_end_candidate text;
      v_leave_type_candidate text;
    BEGIN
      v_leave_user_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'user_id', ''),
        NULLIF(v_proposal.payload->>'userId', ''),
        NULLIF(v_proposal.payload->>'target_user_id', ''),
        NULLIF(v_proposal.payload->>'targetUserId', ''),
        CASE
          WHEN COALESCE(v_proposal.created_by->>'type', '') = 'human'
            THEN NULLIF(v_proposal.created_by->>'id', '')
          ELSE NULL
        END
      );

      IF v_leave_user_candidate IS NOT NULL
        AND v_leave_user_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN
        v_leave_user_id := v_leave_user_candidate::uuid;
      ELSE
        v_leave_user_id := NULL;
      END IF;

      v_leave_start_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'start_date', ''),
        NULLIF(v_proposal.payload->>'startDate', ''),
        NULLIF(v_proposal.payload->>'date', '')
      );

      IF v_leave_start_candidate IS NOT NULL
        AND v_leave_start_candidate ~ '^\d{4}-\d{2}-\d{2}$'
      THEN
        v_leave_start_date := v_leave_start_candidate::date;
      ELSE
        v_leave_start_date := NULL;
      END IF;

      v_leave_end_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'end_date', ''),
        NULLIF(v_proposal.payload->>'endDate', ''),
        v_leave_start_candidate
      );

      IF v_leave_end_candidate IS NOT NULL
        AND v_leave_end_candidate ~ '^\d{4}-\d{2}-\d{2}$'
      THEN
        v_leave_end_date := v_leave_end_candidate::date;
      ELSE
        v_leave_end_date := NULL;
      END IF;

      v_leave_type_candidate := LOWER(COALESCE(
        NULLIF(v_proposal.payload->>'leave_type', ''),
        NULLIF(v_proposal.payload->>'leaveType', ''),
        NULLIF(v_proposal.payload->>'schedule_type', ''),
        NULLIF(v_proposal.payload->>'scheduleType', ''),
        NULLIF(v_proposal.payload->>'type', ''),
        'vacation'
      ));

      v_leave_type := CASE
        WHEN v_leave_type_candidate IN ('vacation', 'sick_leave', 'business_trip', 'training')
          THEN v_leave_type_candidate
        WHEN v_leave_type_candidate IN ('leave', 'holiday')
          THEN 'vacation'
        WHEN v_leave_type_candidate IN ('sick', 'sickleave')
          THEN 'sick_leave'
        WHEN v_leave_type_candidate IN ('trip', 'business-trip', 'businesstrip')
          THEN 'business_trip'
        ELSE NULL
      END;

      v_leave_reason := COALESCE(
        NULLIF(v_proposal.payload->>'reason', ''),
        NULLIF(v_proposal.payload->>'note', ''),
        NULLIF(v_proposal.payload->>'description', ''),
        NULLIF(v_proposal.description, '')
      );

      IF v_leave_user_id IS NOT NULL
        AND v_leave_start_date IS NOT NULL
        AND v_leave_end_date IS NOT NULL
        AND v_leave_start_date <= v_leave_end_date
        AND v_leave_type IS NOT NULL
      THEN
        SELECT id INTO v_leave_schedule_id
        FROM personal_schedules
        WHERE user_id = v_leave_user_id
          AND start_date = v_leave_start_date
          AND end_date = v_leave_end_date
          AND type = v_leave_type
        LIMIT 1;

        IF v_leave_schedule_id IS NULL THEN
          INSERT INTO personal_schedules (
            user_id,
            start_date,
            end_date,
            type,
            reason,
            approved,
            updated_at
          )
          VALUES (
            v_leave_user_id,
            v_leave_start_date,
            v_leave_end_date,
            v_leave_type,
            v_leave_reason,
            true,
            v_now
          );
        ELSE
          UPDATE personal_schedules
          SET approved = true,
              reason = COALESCE(v_leave_reason, reason),
              updated_at = v_now
          WHERE id = v_leave_schedule_id;
        END IF;
      END IF;
    END;
  END IF;

  -- 7. Proposalをexecutedに更新
  UPDATE proposals
  SET status = 'executed',
      executed_at = v_now,
      executed_by = p_executor,
      result_event_id = v_event_id,
      updated_at = v_now
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  RETURNING * INTO v_proposal;

  RETURN to_jsonb(v_proposal);
END;
$$;

COMMENT ON FUNCTION public.execute_proposal_atomic IS
  'Proposal実行を原子的に実行: Event作成 + 仕訳生成 + assignment.create/leave.request副作用 + ステータス更新を1トランザクションで';
