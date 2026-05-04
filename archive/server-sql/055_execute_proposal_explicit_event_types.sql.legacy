-- ============================================================
-- execute_proposal_atomic explicit event type alignment
-- ============================================================
-- 目的:
--   1) ledger_events.event_type CHECK を explicit event type に追従
--   2) execute_proposal_atomic の event mapping を ProposalService fallback と揃える
-- ============================================================

ALTER TABLE public.ledger_events
  DROP CONSTRAINT IF EXISTS ledger_events_event_type_check;

ALTER TABLE public.ledger_events
  ADD CONSTRAINT ledger_events_event_type_check
  CHECK (event_type IN (
    'expense_recorded',
    'expense_voided',
    'income_recorded',
    'invoice_issued',
    'invoice_sent',
    'payment_received',
    'reward_calculated',
    'reward_adjusted',
    'skill_achieved',
    'skill_revoked',
    'evaluation_finalized',
    'assignment.scheduled',
    'assignment.rescheduled',
    'assignment.cancelled',
    'leave.recorded',
    'communication.review_recorded',
    'communication.task_recorded',
    'task.revision_requested',
    'site.created',
    'internal_transfer'
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
  -- LUQO用変数
  v_luqo_member_id uuid;
  v_luqo_period text;
  v_luqo_lu integer;
  v_luqo_q integer;
  v_luqo_o integer;
  v_luqo_score integer;
  v_luqo_star_id uuid;
  v_luqo_cat_id uuid;
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
    WHEN 'expense.void' THEN 'expense_voided'
    WHEN 'income.create' THEN 'income_recorded'
    WHEN 'income.update' THEN 'income_recorded'
    WHEN 'invoice.create' THEN 'invoice_issued'
    WHEN 'invoice.send' THEN 'invoice_sent'
    WHEN 'invoice.mark_paid' THEN 'payment_received'
    WHEN 'reward.calculate' THEN 'reward_calculated'
    WHEN 'reward.adjust' THEN 'reward_adjusted'
    WHEN 'skill.achieve' THEN 'skill_achieved'
    WHEN 'skill.revoke' THEN 'skill_revoked'
    WHEN 'evaluation.finalize' THEN 'evaluation_finalized'
    WHEN 'assignment.create' THEN 'assignment.scheduled'
    WHEN 'assignment.update' THEN 'assignment.rescheduled'
    WHEN 'assignment.cancel' THEN 'assignment.cancelled'
    WHEN 'leave.request' THEN 'leave.recorded'
    WHEN 'communication.review' THEN 'communication.review_recorded'
    WHEN 'communication.task' THEN 'communication.task_recorded'
    WHEN 'task.revision.request' THEN 'task.revision_requested'
    WHEN 'site.create' THEN 'site.created'
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

      v_category := LOWER(COALESCE(v_proposal.payload->>'category', ''));
      v_expense_account := CASE v_category
        WHEN 'material' THEN '5100'
        WHEN 'materials' THEN '5100'
        WHEN 'tool' THEN '5200'
        WHEN 'tools' THEN '5200'
        WHEN 'travel' THEN '5300'
        WHEN 'transportation' THEN '5300'
        WHEN 'food' THEN '5400'
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
          UNION ALL SELECT NULLIF(v_proposal.payload->>'workerId', '')
          UNION ALL SELECT NULLIF(v_proposal.payload->>'user_id', '')
          UNION ALL SELECT NULLIF(v_proposal.payload->>'userId', '')
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'worker_ids', '[]'::jsonb))
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'workerIds', '[]'::jsonb))
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'user_ids', '[]'::jsonb))
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'userIds', '[]'::jsonb))
          UNION ALL SELECT NULLIF(elem->>'worker_id', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL SELECT NULLIF(elem->>'workerId', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL SELECT NULLIF(elem->>'user_id', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL SELECT NULLIF(elem->>'userId', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
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
            FROM unnest(COALESCE(s.assigned_users, ARRAY[]::uuid[]) || v_assignment_worker_ids) AS assigned_user
          )
        )
        WHERE s.id = v_assignment_site_id;

        UPDATE profiles
        SET current_site_id = v_assignment_site_id
        WHERE id = ANY(v_assignment_worker_ids);
      END IF;
    END;
  END IF;

  -- 6.6 leave.request のドメイン副作用
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
        WHEN v_leave_type_candidate IN ('leave', 'holiday') THEN 'vacation'
        WHEN v_leave_type_candidate IN ('sick', 'sickleave') THEN 'sick_leave'
        WHEN v_leave_type_candidate IN ('trip', 'business-trip', 'businesstrip') THEN 'business_trip'
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
          INSERT INTO personal_schedules (user_id, start_date, end_date, type, reason, approved, updated_at)
          VALUES (v_leave_user_id, v_leave_start_date, v_leave_end_date, v_leave_type, v_leave_reason, true, v_now);
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

  -- ============================================================
  -- 6.7 luqo.catalog.add — スキルカタログに新項目を追加
  -- ============================================================
  IF v_proposal.type = 'luqo.catalog.add' THEN
    DECLARE
      v_cat_id_candidate text;
      v_item_name text;
      v_item_points integer;
      v_item_is_speed boolean;
    BEGIN
      v_cat_id_candidate := NULLIF(v_proposal.payload->>'category_id', '');
      v_item_name := NULLIF(v_proposal.payload->>'name', '');
      v_item_points := COALESCE((v_proposal.payload->>'points')::integer, 0);
      v_item_is_speed := COALESCE((v_proposal.payload->>'is_speed')::boolean, false);

      IF v_cat_id_candidate IS NOT NULL
        AND v_cat_id_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        AND v_item_name IS NOT NULL
        AND v_item_points > 0
      THEN
        INSERT INTO public.luqo_skill_catalog (
          org_id, category_id, name, is_speed,
          speed_threshold, speed_unit, points, description, created_by
        ) VALUES (
          p_org_id,
          v_cat_id_candidate::uuid,
          v_item_name,
          v_item_is_speed,
          (v_proposal.payload->>'speed_threshold')::integer,
          NULLIF(v_proposal.payload->>'speed_unit', ''),
          v_item_points,
          NULLIF(v_proposal.payload->>'description', ''),
          p_executor
        )
        ON CONFLICT (org_id, category_id, name) DO UPDATE
          SET points = EXCLUDED.points,
              is_speed = EXCLUDED.is_speed,
              speed_threshold = EXCLUDED.speed_threshold,
              speed_unit = EXCLUDED.speed_unit,
              description = EXCLUDED.description,
              is_active = true,
              updated_at = now();
      END IF;
    END;
  END IF;

  -- ============================================================
  -- 6.8 luqo.star.achieve — メンバーのスター達成を記録
  -- ============================================================
  IF v_proposal.type = 'luqo.star.achieve' THEN
    DECLARE
      v_member_candidate text;
      v_star_candidate text;
    BEGIN
      v_member_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'member_id', ''),
        CASE WHEN COALESCE(v_proposal.created_by->>'type', '') = 'human'
          THEN NULLIF(v_proposal.created_by->>'id', '') ELSE NULL END
      );
      v_star_candidate := NULLIF(v_proposal.payload->>'star_id', '');

      IF v_member_candidate IS NOT NULL
        AND v_member_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        AND v_star_candidate IS NOT NULL
        AND v_star_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN
        v_luqo_member_id := v_member_candidate::uuid;
        v_luqo_star_id := v_star_candidate::uuid;

        INSERT INTO public.luqo_star_achievements (org_id, member_id, star_id, achieved_at, proposal_id)
        VALUES (p_org_id, v_luqo_member_id, v_luqo_star_id, v_now, p_proposal_id)
        ON CONFLICT (org_id, member_id, star_id) DO UPDATE
          SET revoked_at = NULL,
              revoke_proposal_id = NULL,
              achieved_at = v_now,
              proposal_id = p_proposal_id;
      END IF;
    END;
  END IF;

  -- ============================================================
  -- 6.9 luqo.score.update — LUQO行動スコア(LU/Q/O)を更新
  -- ============================================================
  IF v_proposal.type = 'luqo.score.update' THEN
    DECLARE
      v_member_candidate text;
    BEGIN
      v_member_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'member_id', ''),
        CASE WHEN COALESCE(v_proposal.created_by->>'type', '') = 'human'
          THEN NULLIF(v_proposal.created_by->>'id', '') ELSE NULL END
      );
      v_luqo_period := NULLIF(v_proposal.payload->>'period', '');
      v_luqo_lu := (v_proposal.payload->>'lu_score')::integer;
      v_luqo_q := (v_proposal.payload->>'q_score')::integer;
      v_luqo_o := (v_proposal.payload->>'o_score')::integer;

      IF v_member_candidate IS NOT NULL
        AND v_member_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        AND v_luqo_period IS NOT NULL
        AND v_luqo_lu IS NOT NULL
        AND v_luqo_q IS NOT NULL
        AND v_luqo_o IS NOT NULL
      THEN
        v_luqo_member_id := v_member_candidate::uuid;
        -- LU:Q:O = 30:50:20 で加重平均
        v_luqo_score := ROUND(v_luqo_lu * 0.30 + v_luqo_q * 0.50 + v_luqo_o * 0.20)::integer;

        INSERT INTO public.luqo_period_scores (
          org_id, member_id, period,
          lu_score, q_score, o_score, luqo_score,
          submission_rate, updated_at
        ) VALUES (
          p_org_id, v_luqo_member_id, v_luqo_period,
          v_luqo_lu, v_luqo_q, v_luqo_o, v_luqo_score,
          COALESCE((v_proposal.payload->>'submission_rate')::integer, 0),
          v_now
        )
        ON CONFLICT (org_id, member_id, period) DO UPDATE
          SET lu_score = EXCLUDED.lu_score,
              q_score = EXCLUDED.q_score,
              o_score = EXCLUDED.o_score,
              luqo_score = EXCLUDED.luqo_score,
              submission_rate = EXCLUDED.submission_rate,
              updated_at = v_now;
      END IF;
    END;
  END IF;

  -- ============================================================
  -- 6.10 luqo.reward.calculate — 月次報酬計算を確定
  -- ============================================================
  IF v_proposal.type = 'luqo.reward.calculate' THEN
    DECLARE
      v_reward_period text;
      v_reward_profit integer;
      v_reward_company_rate numeric(4, 2);
      v_reward_distributable integer;
      v_reward_breakdown jsonb;
    BEGIN
      v_reward_period := NULLIF(v_proposal.payload->>'period', '');
      v_reward_profit := COALESCE((v_proposal.payload->>'profit')::integer, 0);
      v_reward_company_rate := COALESCE((v_proposal.payload->>'company_rate')::numeric, 0);
      v_reward_distributable := ROUND(v_reward_profit * (1 - v_reward_company_rate / 100))::integer;
      v_reward_breakdown := COALESCE(v_proposal.payload->'breakdown', '[]'::jsonb);

      IF v_reward_period IS NOT NULL AND v_reward_profit > 0 THEN
        INSERT INTO public.luqo_reward_calculations (
          org_id, period, profit, company_rate, distributable,
          breakdown, proposal_id, finalized
        ) VALUES (
          p_org_id, v_reward_period, v_reward_profit,
          v_reward_company_rate, v_reward_distributable,
          v_reward_breakdown, p_proposal_id, true
        )
        ON CONFLICT (org_id, period) DO UPDATE
          SET profit = EXCLUDED.profit,
              company_rate = EXCLUDED.company_rate,
              distributable = EXCLUDED.distributable,
              breakdown = EXCLUDED.breakdown,
              proposal_id = EXCLUDED.proposal_id,
              finalized = true;

        -- 対象期間のスコアをfinalized=trueに
        UPDATE public.luqo_period_scores
        SET finalized = true, updated_at = v_now
        WHERE org_id = p_org_id AND period = v_reward_period;
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
  'Proposal実行を原子的に実行: Event作成 + 仕訳生成 + explicit event mapping + ドメイン副作用(assignment/leave/luqo) + ステータス更新を1トランザクションで';
