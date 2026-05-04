-- ============================================================
-- GENBA QUEST - 経理モジュール 関数・トリガー
-- ============================================================

-- ============================================================
-- 請求書番号採番（年度=4/1-3/31）
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_jp_fiscal_year(d date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM d) >= 4 THEN EXTRACT(YEAR FROM d)::int ELSE (EXTRACT(YEAR FROM d)::int - 1) END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_next_invoice_no(p_issue_date date DEFAULT CURRENT_DATE)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy integer;
  v_seq integer;
BEGIN
  v_fy := public.get_jp_fiscal_year(p_issue_date);

  -- next_seq is "last issued sequence" (starts at 1).
  INSERT INTO public.invoice_number_sequences (fiscal_year, next_seq)
  VALUES (v_fy, 1)
  ON CONFLICT (fiscal_year)
  DO UPDATE SET next_seq = public.invoice_number_sequences.next_seq + 1
  RETURNING next_seq INTO v_seq;

  RETURN 'GQ-' || v_fy::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- ============================================================
-- 高リスク経費の承認者自動割当トリガー
-- ============================================================
-- INSERT 時点で承認待ちにし、承認者を自動割当（申請者除外）
-- 金額に応じた承認権限を持つユーザーを優先選択

CREATE OR REPLACE FUNCTION public.accounting_auto_assign_reviewer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviewer uuid;
  v_amount numeric;
BEGIN
  IF NEW.kind = 'expense' AND NEW.risk_level = 'HIGH' THEN
    IF NEW.reviewer_id IS NULL THEN
      v_amount := COALESCE(NEW.amount_total, 0);

      -- 金額に応じた承認権限を持つユーザーを選択（申請者除外）
      SELECT id
        INTO v_reviewer
      FROM public.profiles
      WHERE id <> NEW.created_by
        AND COALESCE(approval_limit, 50000) >= v_amount
      ORDER BY COALESCE(approval_limit, 50000) ASC, random()
      LIMIT 1;

      -- 承認権限を持つユーザーがいない場合は admin/manager を選択
      IF v_reviewer IS NULL THEN
        SELECT id
          INTO v_reviewer
        FROM public.profiles
        WHERE id <> NEW.created_by
          AND role IN ('admin', 'manager')
        ORDER BY random()
        LIMIT 1;
      END IF;

      -- それでもいない場合は従来通りランダム選択
      IF v_reviewer IS NULL THEN
        SELECT id
          INTO v_reviewer
        FROM public.profiles
        WHERE id <> NEW.created_by
        ORDER BY random()
        LIMIT 1;
      END IF;

      IF v_reviewer IS NULL THEN
        RAISE EXCEPTION 'no eligible reviewer (only applicant exists?)';
      END IF;

      NEW.reviewer_id := v_reviewer;
    END IF;

    NEW.review_status := 'pending';
    NEW.status := 'pending_review';
    NEW.review_assigned_at := COALESCE(NEW.review_assigned_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounting_transactions_auto_assign_reviewer ON public.accounting_transactions;
CREATE TRIGGER accounting_transactions_auto_assign_reviewer
BEFORE INSERT ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.accounting_auto_assign_reviewer();

-- ============================================================
-- 承認者割当RPC（明示的に呼び出す場合）
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_assign_random_reviewer(p_transaction_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_existing uuid;
  v_reviewer uuid;
  v_amount numeric;
BEGIN
  SELECT created_by, reviewer_id, COALESCE(amount_total, 0)
    INTO v_created_by, v_existing, v_amount
  FROM public.accounting_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found: %', p_transaction_id;
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- 金額に応じた承認権限を持つユーザーを選択（申請者除外）
  SELECT id
    INTO v_reviewer
  FROM public.profiles
  WHERE id <> v_created_by
    AND COALESCE(approval_limit, 50000) >= v_amount
  ORDER BY COALESCE(approval_limit, 50000) ASC, random()
  LIMIT 1;

  -- 承認権限を持つユーザーがいない場合は admin/manager を選択
  IF v_reviewer IS NULL THEN
    SELECT id
      INTO v_reviewer
    FROM public.profiles
    WHERE id <> v_created_by
      AND role IN ('admin', 'manager')
    ORDER BY random()
    LIMIT 1;
  END IF;

  -- それでもいない場合は従来通りランダム選択
  IF v_reviewer IS NULL THEN
    SELECT id
      INTO v_reviewer
    FROM public.profiles
    WHERE id <> v_created_by
    ORDER BY random()
    LIMIT 1;
  END IF;

  IF v_reviewer IS NULL THEN
    RAISE EXCEPTION 'no eligible reviewer (only applicant exists?)';
  END IF;

  UPDATE public.accounting_transactions
  SET reviewer_id = v_reviewer,
      review_status = 'pending',
      status = 'pending_review',
      review_assigned_at = now()
  WHERE id = p_transaction_id;

  RETURN v_reviewer;
END;
$$;
