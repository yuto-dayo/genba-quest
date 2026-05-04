-- ============================================================
-- execute_proposal_atomic: Proposal実行を1トランザクションで原子実行
-- ============================================================
-- DAO設計原則: 承認 + Event発行 + 状態更新 = 1つのDBトランザクション
-- 参照: docs/DESIGN_PHILOSOPHY.md
--
-- 冪等性: 既にexecutedならそのまま返す
-- バランスチェック: 仕訳は借方合計=貸方合計を保証
-- ============================================================

-- NOTE:
-- 戻り値変更（例: proposals -> jsonb）は CREATE OR REPLACE だけでは不可。
-- 既存シグネチャを先に削除してから再作成する。
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
  'Proposal実行を原子的に実行: Event作成 + 仕訳生成 + ステータス更新を1トランザクションで';
