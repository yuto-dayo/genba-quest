-- v2.2 P0 follow-up: wire party/org boundary asserts into canonical posting RPCs.
--
-- Re-defines existing canonical posting functions to call the new
-- private.assert_customer_belongs_to_org / assert_member_belongs_to_org
-- helpers right after the membership check. Function signatures are
-- unchanged; only the body adds a guard clause that fails closed when a
-- non-null party id does not belong to p_org_id.

-- Source: 20260509131814_canonical_expense_posting_rpc.sql
-- Adds PERFORM private.assert_member_belongs_to_org(p_claimant_member_id, p_org_id);
CREATE OR REPLACE FUNCTION public.rpc_post_accounting_expense_canonical(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_idempotency_key text,
  p_cost_center text,
  p_site_id uuid DEFAULT NULL::uuid,
  p_vendor_name text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_recorded_date date DEFAULT CURRENT_DATE,
  p_amount_subtotal numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_amount_total numeric DEFAULT 0,
  p_category text DEFAULT 'other'::text,
  p_expense_item_code text DEFAULT NULL::text,
  p_expense_item_other text DEFAULT NULL::text,
  p_tax_category text DEFAULT '10_STANDARD'::text,
  p_risk_level text DEFAULT 'LOW'::text,
  p_source_document_id uuid DEFAULT NULL::uuid,
  p_input_sources jsonb DEFAULT '{}'::jsonb,
  p_expense_scope text DEFAULT 'job'::text,
  p_paid_by text DEFAULT 'org'::text,
  p_claimant_member_id uuid DEFAULT NULL::uuid,
  p_settlement_type text DEFAULT 'paid'::text,
  p_payment_account text DEFAULT NULL::text,
  p_reimbursement_status text DEFAULT NULL::text,
  p_recurring_template_id uuid DEFAULT NULL::uuid,
  p_actor_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_proposal_id uuid;
  v_execution_id uuid;
  v_posting_group_id uuid;
  v_transaction public.accounting_transactions%ROWTYPE;
  v_proposal public.proposals%ROWTYPE;
  v_existing_execution record;
  v_journal_entry_id uuid;
  v_line_no integer := 1;
  v_description text;
  v_expense_amount numeric;
  v_tax_amount numeric;
  v_total_amount numeric;
  v_expense_account_code text;
  v_expense_account_name text;
  v_credit_account_code text;
  v_credit_account_name text;
  v_tax_type text;
  v_tax_rate numeric;
BEGIN
  PERFORM private.assert_rpc_active_membership(
    p_org_id,
    p_actor_user_id,
    p_membership_id
  );

  PERFORM private.assert_member_belongs_to_org(
    p_claimant_member_id,
    p_org_id
  );

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount_total IS NULL OR p_amount_total <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_TOTAL_MUST_BE_POSITIVE'
      USING ERRCODE = '23514';
  END IF;

  IF p_expense_scope NOT IN ('job', 'overhead') THEN
    RAISE EXCEPTION 'EXPENSE_SCOPE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  IF p_paid_by NOT IN ('org', 'member') THEN
    RAISE EXCEPTION 'PAID_BY_INVALID'
      USING ERRCODE = '23514';
  END IF;

  IF p_paid_by = 'member' AND p_claimant_member_id IS NULL THEN
    RAISE EXCEPTION 'CLAIMANT_MEMBER_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_settlement_type NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'SETTLEMENT_TYPE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  IF p_expense_scope = 'job' AND p_site_id IS NULL THEN
    RAISE EXCEPTION 'SITE_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  SELECT execution.*
  INTO v_existing_execution
  FROM public.proposal_executions AS execution
  WHERE execution.org_id = p_org_id
    AND execution.idempotency_key = 'accounting.expenses.create:' || p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT transaction.*
    INTO v_transaction
    FROM public.accounting_transactions AS transaction
    WHERE transaction.org_id = p_org_id
      AND transaction.proposal_execution_id = v_existing_execution.id
    ORDER BY transaction.created_at DESC
    LIMIT 1;

    SELECT proposal.*
    INTO v_proposal
    FROM public.proposals AS proposal
    WHERE proposal.org_id = p_org_id
      AND proposal.id = v_existing_execution.proposal_id;

    RETURN jsonb_build_object(
      'org_id', p_org_id,
      'transaction', to_jsonb(v_transaction),
      'proposal', jsonb_build_object(
        'id', v_proposal.id,
        'type', v_proposal.type,
        'status', 'posted_canonical_projection',
        'db_status', v_proposal.status,
        'lineage_mode', 'transition',
        'lifecycle_engine', 'money_transition',
        'full_proposal_lifecycle', false,
        'source_route', 'accounting.expenses.create',
        'source_idempotency_key', p_idempotency_key
      ),
      'execution', to_jsonb(v_existing_execution),
      'posting_group_id', v_transaction.posting_group_id,
      'journal_entry_id', v_transaction.journal_entry_id,
      'projection', jsonb_build_object(
        'projection_source', v_transaction.projection_source,
        'legacy_transaction_id', v_transaction.id,
        'legacy_transaction_kind', v_transaction.kind,
        'proposal_id', v_transaction.proposal_id,
        'proposal_execution_id', v_transaction.proposal_execution_id,
        'posting_group_id', v_transaction.posting_group_id,
        'journal_entry_id', v_transaction.journal_entry_id
      ),
      'posting', jsonb_build_object(
        'status', 'posted',
        'mode', 'canonical_expense_posting',
        'affects_pl', true,
        'affects_revenue', false,
        'affects_ar', false
      ),
      'rpc_membership_verified', true
    );
  END IF;

  IF p_site_id IS NOT NULL THEN
    PERFORM 1
    FROM public.sites AS site
    WHERE site.org_id = p_org_id
      AND site.id = p_site_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SITE_NOT_FOUND'
        USING ERRCODE = '02000';
    END IF;
  END IF;

  v_tax_amount := CASE
    WHEN p_tax_category IN ('00_EXEMPT', '00_TAXFREE') THEN 0
    ELSE abs(COALESCE(p_tax_amount, 0))
  END;
  v_total_amount := abs(COALESCE(p_amount_total, 0));
  v_expense_amount := CASE
    WHEN v_tax_amount > 0
      AND (
        abs(COALESCE(p_amount_subtotal, 0)) <= 0
        OR abs(abs(COALESCE(p_amount_subtotal, 0)) - v_total_amount) <= 1
        OR abs(COALESCE(p_amount_subtotal, 0)) + v_tax_amount > v_total_amount + 1
        OR abs(COALESCE(p_amount_subtotal, 0)) > v_total_amount + 1
      )
      THEN GREATEST(v_total_amount - v_tax_amount, 0)
    WHEN abs(COALESCE(p_amount_subtotal, 0)) > 0
      THEN abs(COALESCE(p_amount_subtotal, 0))
    ELSE GREATEST(v_total_amount - v_tax_amount, 0)
  END;
  v_description := COALESCE(NULLIF(btrim(p_description), ''), NULLIF(btrim(p_vendor_name), ''), '経費');

  v_expense_account_code := CASE p_category
    WHEN 'material' THEN '5110'
    WHEN 'tool' THEN '5120'
    WHEN 'travel' THEN '5130'
    WHEN 'food' THEN '5140'
    WHEN 'fuel' THEN '5900'
    WHEN 'utility' THEN '5900'
    ELSE '5900'
  END;
  v_expense_account_name := CASE p_category
    WHEN 'material' THEN '材料費'
    WHEN 'tool' THEN '工具備品費'
    WHEN 'travel' THEN '交通費'
    WHEN 'food' THEN '会議費'
    WHEN 'fuel' THEN '燃料費'
    WHEN 'utility' THEN '光熱費'
    ELSE 'その他経費'
  END;

  IF p_paid_by = 'member' THEN
    v_credit_account_code := '2140';
    v_credit_account_name := 'メンバー立替未払金';
  ELSIF p_settlement_type = 'unpaid' THEN
    v_credit_account_code := '2120';
    v_credit_account_name := '未払金';
  ELSIF p_payment_account = 'bank' THEN
    v_credit_account_code := '1120';
    v_credit_account_name := '普通預金';
  ELSE
    v_credit_account_code := '1100';
    v_credit_account_name := '現金';
  END IF;

  v_tax_rate := CASE
    WHEN p_tax_category = '10_STANDARD' THEN 0.10
    WHEN p_tax_category = '08_REDUCED' THEN 0.08
    ELSE 0
  END;
  v_tax_type := CASE
    WHEN p_tax_category = '00_EXEMPT' THEN 'exempt'
    WHEN p_tax_category = '00_TAXFREE' THEN 'taxfree'
    ELSE 'taxable'
  END;

  INSERT INTO public.proposals (
    org_id,
    type,
    status,
    created_by,
    payload,
    description,
    policy_ref,
    approvals,
    required_approvals,
    executed_at,
    executed_by,
    document_id,
    site_id,
    idempotency_key
  )
  VALUES (
    p_org_id,
    'expense.create',
    'executed',
    jsonb_build_object(
      'type', 'human',
      'id', p_actor_user_id,
      'name', p_actor_name
    ),
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'transition_status', 'posted_canonical_projection',
      'source_route', 'accounting.expenses.create',
      'source_idempotency_key', p_idempotency_key,
      'cost_center', p_cost_center,
      'site_id', p_site_id,
      'vendor_name', p_vendor_name,
      'description', p_description,
      'recorded_date', p_recorded_date,
      'amount_subtotal', v_expense_amount,
      'tax_amount', v_tax_amount,
      'amount_total', v_total_amount,
      'category', p_category,
      'expense_item_code', p_expense_item_code,
      'expense_item_other', p_expense_item_other,
      'tax_category', p_tax_category,
      'risk_level', p_risk_level,
      'review_required', false,
      'source_document_id', p_source_document_id,
      'input_sources', COALESCE(p_input_sources, '{}'::jsonb),
      'expense_scope', p_expense_scope,
      'paid_by', p_paid_by,
      'claimant_member_id', p_claimant_member_id,
      'settlement_type', p_settlement_type,
      'payment_account', p_payment_account,
      'reimbursement_status', p_reimbursement_status,
      'recurring_template_id', p_recurring_template_id
    ),
    '経費登録: ' || v_description,
    'legacy_direct_transition',
    '[]'::jsonb,
    0,
    now(),
    jsonb_build_object(
      'type', 'human',
      'id', p_actor_user_id,
      'name', p_actor_name
    ),
    p_source_document_id,
    p_site_id,
    'accounting.expenses.create:' || p_idempotency_key
  )
  RETURNING id
  INTO v_proposal_id;

  INSERT INTO public.proposal_executions (
    org_id,
    proposal_id,
    status,
    attempt_no,
    started_at,
    idempotency_key
  )
  VALUES (
    p_org_id,
    v_proposal_id,
    'running',
    1,
    now(),
    'accounting.expenses.create:' || p_idempotency_key
  )
  RETURNING id
  INTO v_execution_id;

  INSERT INTO public.posting_groups (
    org_id,
    group_type,
    proposal_execution_id,
    accounting_date,
    posted_at,
    currency,
    description
  )
  VALUES (
    p_org_id,
    'manual_adjustment',
    v_execution_id,
    p_recorded_date,
    now(),
    'JPY',
    'Canonical expense posting: ' || v_description
  )
  RETURNING id
  INTO v_posting_group_id;

  INSERT INTO public.accounting_transactions (
    org_id,
    kind,
    cost_center,
    site_id,
    vendor_name,
    description,
    recorded_date,
    amount_subtotal,
    tax_amount,
    amount_total,
    category,
    expense_item_code,
    expense_item_other,
    tax_category,
    risk_level,
    status,
    review_status,
    source_document_id,
    input_sources,
    created_by,
    projection_source,
    proposal_id,
    proposal_execution_id,
    posting_group_id,
    legacy_source_route,
    legacy_source_id,
    metadata_json,
    expense_scope,
    paid_by,
    claimant_member_id,
    settlement_type,
    payment_account,
    reimbursement_status,
    recurring_template_id
  )
  VALUES (
    p_org_id,
    'expense',
    p_cost_center,
    p_site_id,
    p_vendor_name,
    p_description,
    p_recorded_date,
    v_expense_amount,
    v_tax_amount,
    v_total_amount,
    p_category,
    p_expense_item_code,
    p_expense_item_other,
    p_tax_category,
    p_risk_level,
    'posted',
    'not_required',
    p_source_document_id,
    COALESCE(p_input_sources, '{}'::jsonb),
    p_actor_user_id,
    'canonical_posting_projection',
    v_proposal_id,
    v_execution_id,
    v_posting_group_id,
    'accounting.expenses.create',
    p_idempotency_key,
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'posting_mode', 'canonical_expense_posting',
      'expense_scope', p_expense_scope,
      'paid_by', p_paid_by,
      'settlement_type', p_settlement_type,
      'payment_account', p_payment_account,
      'reimbursement_status', p_reimbursement_status,
      'recurring_template_id', p_recurring_template_id
    ),
    p_expense_scope,
    p_paid_by,
    p_claimant_member_id,
    p_settlement_type,
    p_payment_account,
    p_reimbursement_status,
    p_recurring_template_id
  )
  RETURNING *
  INTO v_transaction;

  INSERT INTO public.accounting_journal_entries (
    org_id,
    transaction_id,
    posting_group_id,
    entry_date,
    memo,
    created_by
  )
  VALUES (
    p_org_id,
    v_transaction.id,
    v_posting_group_id,
    p_recorded_date,
    v_description,
    p_actor_user_id
  )
  RETURNING id
  INTO v_journal_entry_id;

  INSERT INTO public.accounting_journal_lines (
    org_id,
    entry_id,
    line_no,
    account_code,
    account_name,
    debit,
    credit,
    tax_rate,
    tax_type,
    description,
    site_id,
    vendor_id,
    dimension_json
  )
  VALUES (
    p_org_id,
    v_journal_entry_id,
    v_line_no,
    v_expense_account_code,
    v_expense_account_name,
    v_expense_amount,
    0,
    v_tax_rate,
    v_tax_type,
    v_description,
    p_site_id,
    NULL,
    jsonb_build_object(
      'expense_scope', p_expense_scope,
      'paid_by', p_paid_by,
      'claimant_member_id', p_claimant_member_id
    )
  );

  IF v_tax_amount > 0 THEN
    v_line_no := v_line_no + 1;

    INSERT INTO public.accounting_journal_lines (
      org_id,
      entry_id,
      line_no,
      account_code,
      account_name,
      debit,
      credit,
      description,
      site_id,
      dimension_json
    )
    VALUES (
      p_org_id,
      v_journal_entry_id,
      v_line_no,
      '1500',
      '仮払消費税',
      v_tax_amount,
      0,
      v_description,
      p_site_id,
      jsonb_build_object(
        'expense_scope', p_expense_scope,
        'paid_by', p_paid_by,
        'claimant_member_id', p_claimant_member_id
      )
    );
  END IF;

  v_line_no := v_line_no + 1;

  INSERT INTO public.accounting_journal_lines (
    org_id,
    entry_id,
    line_no,
    account_code,
    account_name,
    debit,
    credit,
    description,
    site_id,
    dimension_json
  )
  VALUES (
    p_org_id,
    v_journal_entry_id,
    v_line_no,
    v_credit_account_code,
    v_credit_account_name,
    0,
    v_total_amount,
    v_description,
    p_site_id,
    jsonb_build_object(
      'expense_scope', p_expense_scope,
      'paid_by', p_paid_by,
      'claimant_member_id', p_claimant_member_id,
      'settlement_type', p_settlement_type,
      'payment_account', p_payment_account,
      'reimbursement_status', p_reimbursement_status
    )
  );

  PERFORM private.assert_accounting_journal_entry_balanced(v_journal_entry_id);

  UPDATE public.accounting_journal_entries
  SET posted_at = now()
  WHERE org_id = p_org_id
    AND id = v_journal_entry_id;

  UPDATE public.accounting_transactions
  SET journal_entry_id = v_journal_entry_id
  WHERE org_id = p_org_id
    AND id = v_transaction.id
  RETURNING *
  INTO v_transaction;

  UPDATE public.proposal_executions
  SET status = 'succeeded',
      finished_at = now(),
      result_json = jsonb_build_object(
        'transaction_id', v_transaction.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id,
        'projection_source', 'canonical_posting_projection'
      )
  WHERE org_id = p_org_id
    AND id = v_execution_id
  RETURNING *
  INTO v_existing_execution;

  SELECT proposal.*
  INTO v_proposal
  FROM public.proposals AS proposal
  WHERE proposal.org_id = p_org_id
    AND proposal.id = v_proposal_id;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'transaction', to_jsonb(v_transaction),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'type', v_proposal.type,
      'status', 'posted_canonical_projection',
      'db_status', v_proposal.status,
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.expenses.create',
      'source_idempotency_key', p_idempotency_key
    ),
    'execution', to_jsonb(v_existing_execution),
    'posting_group_id', v_posting_group_id,
    'journal_entry_id', v_journal_entry_id,
    'projection', jsonb_build_object(
      'projection_source', v_transaction.projection_source,
      'legacy_transaction_id', v_transaction.id,
      'legacy_transaction_kind', v_transaction.kind,
      'proposal_id', v_transaction.proposal_id,
      'proposal_execution_id', v_transaction.proposal_execution_id,
      'posting_group_id', v_transaction.posting_group_id,
      'journal_entry_id', v_transaction.journal_entry_id
    ),
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'canonical_expense_posting',
      'affects_pl', true,
      'affects_revenue', false,
      'affects_ar', false
    ),
    'rpc_membership_verified', true
  );
EXCEPTION
  WHEN others THEN
    IF v_execution_id IS NOT NULL THEN
      UPDATE public.proposal_executions
      SET status = 'failed',
          finished_at = now(),
          error_code = SQLSTATE,
          error_message = SQLERRM
      WHERE org_id = p_org_id
        AND id = v_execution_id;
    END IF;

    RAISE;
END;
$$;

-- Source: 20260509133923_canonical_payment_receipt_posting_rpc.sql
-- Adds PERFORM private.assert_customer_belongs_to_org(p_customer_id, p_org_id);
CREATE OR REPLACE FUNCTION public.rpc_record_accounting_payment_event_canonical(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_idempotency_key text,
  p_received_on date,
  p_amount numeric,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_payment_method text DEFAULT NULL::text,
  p_payment_account text DEFAULT NULL::text,
  p_external_reference text DEFAULT NULL::text,
  p_metadata_json jsonb DEFAULT '{}'::jsonb,
  p_actor_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_payment public.accounting_payments%ROWTYPE;
  v_proposal public.proposals%ROWTYPE;
  v_existing_execution record;
  v_proposal_id uuid;
  v_execution_id uuid;
  v_posting_group_id uuid;
  v_journal_entry_id uuid;
  v_cash_account_code text;
  v_cash_account_name text;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_actor_user_id, p_membership_id);

  PERFORM private.assert_customer_belongs_to_org(
    p_customer_id,
    p_org_id
  );

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MUST_BE_POSITIVE'
      USING ERRCODE = '23514';
  END IF;

  IF p_received_on IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_RECEIVED_ON_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_payment_account IS NOT NULL
     AND p_payment_account <> ALL (ARRAY['cash'::text, 'bank'::text]) THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  SELECT execution.*
  INTO v_existing_execution
  FROM public.proposal_executions AS execution
  WHERE execution.org_id = p_org_id
    AND execution.idempotency_key = 'accounting.payments.create:' || p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT payment.*
    INTO v_payment
    FROM public.accounting_payments AS payment
    JOIN public.posting_groups AS posting_group
      ON posting_group.org_id = payment.org_id
     AND posting_group.payment_id = payment.id
    WHERE payment.org_id = p_org_id
      AND posting_group.proposal_execution_id = v_existing_execution.id
    ORDER BY payment.created_at DESC
    LIMIT 1;

    SELECT proposal.*
    INTO v_proposal
    FROM public.proposals AS proposal
    WHERE proposal.org_id = p_org_id
      AND proposal.id = v_existing_execution.proposal_id;

    SELECT posting_group.id
    INTO v_posting_group_id
    FROM public.posting_groups AS posting_group
    WHERE posting_group.org_id = p_org_id
      AND posting_group.proposal_execution_id = v_existing_execution.id
    ORDER BY posting_group.posted_at DESC
    LIMIT 1;

    SELECT entry.id
    INTO v_journal_entry_id
    FROM public.accounting_journal_entries AS entry
    WHERE entry.org_id = p_org_id
      AND entry.posting_group_id = v_posting_group_id
    ORDER BY entry.created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'org_id', p_org_id,
      'payment', to_jsonb(v_payment),
      'proposal', jsonb_build_object(
        'id', v_proposal.id,
        'type', v_proposal.type,
        'status', 'posted_canonical_projection',
        'db_status', v_proposal.status,
        'lineage_mode', 'transition',
        'lifecycle_engine', 'money_transition',
        'full_proposal_lifecycle', false,
        'source_route', 'accounting.payments.create',
        'source_idempotency_key', p_idempotency_key
      ),
      'execution', to_jsonb(v_existing_execution),
      'posting_group_id', v_posting_group_id,
      'journal_entry_id', v_journal_entry_id,
      'posting', jsonb_build_object(
        'status', 'posted',
        'mode', 'payment_received_no_pl_revenue',
        'affects_pl', false,
        'affects_revenue', false,
        'affects_ar', true
      ),
      'projection', jsonb_build_object(
        'projection_source', 'canonical_posting_projection',
        'legacy_payment_id', v_payment.id,
        'proposal_id', v_proposal.id,
        'proposal_execution_id', v_existing_execution.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id
      ),
      'rpc_membership_verified', true
    );
  END IF;

  v_cash_account_code := CASE WHEN p_payment_account = 'bank' THEN '1120' ELSE '1100' END;
  v_cash_account_name := CASE WHEN p_payment_account = 'bank' THEN '普通預金' ELSE '現金' END;

  INSERT INTO public.proposals (
    org_id,
    type,
    status,
    created_by,
    payload,
    description,
    policy_ref,
    approvals,
    required_approvals,
    executed_at,
    executed_by,
    idempotency_key
  )
  VALUES (
    p_org_id,
    'payment.record',
    'executed',
    jsonb_build_object('type', 'human', 'id', p_actor_user_id, 'name', p_actor_name),
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'transition_status', 'posted_canonical_projection',
      'source_route', 'accounting.payments.create',
      'source_idempotency_key', p_idempotency_key,
      'customer_id', p_customer_id,
      'received_on', p_received_on,
      'amount', p_amount,
      'payment_method', p_payment_method,
      'payment_account', p_payment_account,
      'external_reference', p_external_reference,
      'posting_mode', 'payment_received_no_pl_revenue',
      'unapplied_account_type', 'unapplied_cash'
    ),
    '入金記録: ' || p_received_on::text,
    'legacy_direct_transition',
    '[]'::jsonb,
    0,
    now(),
    jsonb_build_object('type', 'human', 'id', p_actor_user_id, 'name', p_actor_name),
    'accounting.payments.create:' || p_idempotency_key
  )
  RETURNING *
  INTO v_proposal;

  INSERT INTO public.proposal_executions (
    org_id,
    proposal_id,
    status,
    attempt_no,
    started_at,
    idempotency_key
  )
  VALUES (
    p_org_id,
    v_proposal.id,
    'running',
    1,
    now(),
    'accounting.payments.create:' || p_idempotency_key
  )
  RETURNING id
  INTO v_execution_id;

  INSERT INTO public.accounting_payments (
    org_id,
    customer_id,
    received_on,
    amount,
    unapplied_amount,
    currency,
    payment_method,
    payment_account,
    external_reference,
    status,
    created_by,
    metadata_json
  )
  VALUES (
    p_org_id,
    p_customer_id,
    p_received_on,
    p_amount,
    p_amount,
    'JPY',
    p_payment_method,
    p_payment_account,
    p_external_reference,
    'received',
    p_actor_user_id,
    COALESCE(p_metadata_json, '{}'::jsonb) || jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.payments.create',
      'source_idempotency_key', p_idempotency_key,
      'posting_mode', 'payment_received_no_pl_revenue',
      'unapplied_account_type', 'unapplied_cash'
    )
  )
  RETURNING *
  INTO v_payment;

  INSERT INTO public.posting_groups (
    org_id,
    group_type,
    proposal_execution_id,
    payment_id,
    accounting_date,
    posted_at,
    currency,
    description,
    metadata_json
  )
  VALUES (
    p_org_id,
    'payment_receipt',
    v_execution_id,
    v_payment.id,
    p_received_on,
    now(),
    'JPY',
    'Canonical payment receipt posting: ' || v_payment.id::text,
    jsonb_build_object(
      'posting_mode', 'payment_received_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    )
  )
  RETURNING id
  INTO v_posting_group_id;

  INSERT INTO public.accounting_journal_entries (
    org_id,
    posting_group_id,
    entry_date,
    memo,
    created_by,
    source_type,
    source_id,
    metadata_json
  )
  VALUES (
    p_org_id,
    v_posting_group_id,
    p_received_on,
    '入金記録',
    p_actor_user_id,
    'payment_receipt',
    v_payment.id,
    jsonb_build_object('posting_mode', 'payment_received_no_pl_revenue')
  )
  RETURNING id
  INTO v_journal_entry_id;

  INSERT INTO public.accounting_journal_lines (
    org_id,
    entry_id,
    line_no,
    account_code,
    account_name,
    debit,
    credit,
    description,
    customer_id,
    dimension_json
  )
  VALUES
    (
      p_org_id,
      v_journal_entry_id,
      1,
      v_cash_account_code,
      v_cash_account_name,
      p_amount,
      0,
      '入金',
      p_customer_id,
      jsonb_build_object('payment_id', v_payment.id, 'payment_account', p_payment_account)
    ),
    (
      p_org_id,
      v_journal_entry_id,
      2,
      '2160',
      '未消込入金',
      0,
      p_amount,
      '未消込入金',
      p_customer_id,
      jsonb_build_object('payment_id', v_payment.id, 'unapplied_account_type', 'unapplied_cash')
    );

  PERFORM private.assert_accounting_journal_entry_balanced(v_journal_entry_id);

  UPDATE public.accounting_journal_entries
  SET posted_at = now()
  WHERE org_id = p_org_id
    AND id = v_journal_entry_id;

  UPDATE public.proposal_executions
  SET status = 'succeeded',
      finished_at = now(),
      result_json = jsonb_build_object(
        'payment_id', v_payment.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id,
        'projection_source', 'canonical_posting_projection'
      )
  WHERE org_id = p_org_id
    AND id = v_execution_id
  RETURNING *
  INTO v_existing_execution;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'payment', to_jsonb(v_payment),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'type', v_proposal.type,
      'status', 'posted_canonical_projection',
      'db_status', v_proposal.status,
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.payments.create',
      'source_idempotency_key', p_idempotency_key
    ),
    'execution', to_jsonb(v_existing_execution),
    'posting_group_id', v_posting_group_id,
    'journal_entry_id', v_journal_entry_id,
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'payment_received_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    ),
    'projection', jsonb_build_object(
      'projection_source', 'canonical_posting_projection',
      'legacy_payment_id', v_payment.id,
      'proposal_id', v_proposal.id,
      'proposal_execution_id', v_existing_execution.id,
      'posting_group_id', v_posting_group_id,
      'journal_entry_id', v_journal_entry_id
    ),
    'rpc_membership_verified', true
  );
EXCEPTION
  WHEN others THEN
    IF v_execution_id IS NOT NULL THEN
      UPDATE public.proposal_executions
      SET status = 'failed',
          finished_at = now(),
          error_code = SQLSTATE,
          error_message = SQLERRM
      WHERE org_id = p_org_id
        AND id = v_execution_id;
    END IF;

    RAISE;
END;
$$;

-- Source: 20260509112149_canonical_sales_posting_rpc.sql
-- Adds PERFORM private.assert_customer_belongs_to_org(p_client_id, p_org_id);
CREATE OR REPLACE FUNCTION public.rpc_post_accounting_sale_canonical(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_idempotency_key text,
  p_site_id uuid,
  p_client_id uuid DEFAULT NULL::uuid,
  p_description text DEFAULT NULL::text,
  p_recorded_date date DEFAULT CURRENT_DATE,
  p_amount_subtotal numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_amount_total numeric DEFAULT 0,
  p_tax_category text DEFAULT '10_STANDARD'::text,
  p_source_document_id uuid DEFAULT NULL::uuid,
  p_input_sources jsonb DEFAULT '{}'::jsonb,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_actor_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_description text;
  v_sales_amount numeric;
  v_line_no integer := 1;
  v_proposal_id uuid;
  v_execution_id uuid;
  v_posting_group_id uuid;
  v_transaction_id uuid;
  v_journal_entry_id uuid;
  v_existing_execution record;
  v_transaction public.accounting_transactions%ROWTYPE;
  v_proposal public.proposals%ROWTYPE;
BEGIN
  PERFORM private.assert_rpc_active_membership(
    p_org_id,
    p_actor_user_id,
    p_membership_id
  );

  PERFORM private.assert_customer_belongs_to_org(
    p_client_id,
    p_org_id
  );

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_site_id IS NULL THEN
    RAISE EXCEPTION 'SITE_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount_total IS NULL OR p_amount_total <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_TOTAL_MUST_BE_POSITIVE'
      USING ERRCODE = '23514';
  END IF;

  SELECT execution.*
  INTO v_existing_execution
  FROM public.proposal_executions AS execution
  WHERE execution.org_id = p_org_id
    AND execution.idempotency_key = 'accounting.sales.adjust:' || p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT transaction.*
    INTO v_transaction
    FROM public.accounting_transactions AS transaction
    WHERE transaction.org_id = p_org_id
      AND transaction.proposal_execution_id = v_existing_execution.id
    ORDER BY transaction.created_at DESC
    LIMIT 1;

    SELECT proposal.*
    INTO v_proposal
    FROM public.proposals AS proposal
    WHERE proposal.org_id = p_org_id
      AND proposal.id = v_existing_execution.proposal_id;

    RETURN jsonb_build_object(
      'org_id', p_org_id,
      'transaction', to_jsonb(v_transaction),
      'proposal', jsonb_build_object(
        'id', v_proposal.id,
        'type', v_proposal.type,
        'status', 'posted_canonical_projection',
        'db_status', v_proposal.status,
        'lineage_mode', 'transition',
        'lifecycle_engine', 'money_transition',
        'full_proposal_lifecycle', false,
        'source_route', 'accounting.sales.adjust',
        'source_idempotency_key', p_idempotency_key
      ),
      'execution', to_jsonb(v_existing_execution),
      'posting_group_id', v_transaction.posting_group_id,
      'journal_entry_id', v_transaction.journal_entry_id,
      'projection', jsonb_build_object(
        'legacy_transaction_id', v_transaction.id,
        'legacy_transaction_kind', v_transaction.kind,
        'projection_source', v_transaction.projection_source,
        'proposal_id', v_transaction.proposal_id,
        'proposal_execution_id', v_transaction.proposal_execution_id,
        'posting_group_id', v_transaction.posting_group_id,
        'journal_entry_id', v_transaction.journal_entry_id
      ),
      'posting', jsonb_build_object(
        'status', 'posted',
        'mode', 'canonical_sales_posting',
        'affects_pl', true,
        'affects_revenue', true,
        'affects_ar', true
      ),
      'rpc_membership_verified', true
    );
  END IF;

  PERFORM 1
  FROM public.sites AS site
  WHERE site.id = p_site_id
    AND site.org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND'
      USING ERRCODE = '02000';
  END IF;

  IF p_client_id IS NOT NULL THEN
    PERFORM 1
    FROM public.clients AS client
    WHERE client.id = p_client_id
      AND client.org_id = p_org_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLIENT_NOT_FOUND'
        USING ERRCODE = '02000';
    END IF;
  END IF;

  v_description := COALESCE(NULLIF(btrim(p_description), ''), '売上');
  v_sales_amount := CASE
    WHEN COALESCE(p_tax_amount, 0) > 0
      AND (
        COALESCE(p_amount_subtotal, 0) <= 0
        OR abs(COALESCE(p_amount_subtotal, 0) - COALESCE(p_amount_total, 0)) <= 1
        OR COALESCE(p_amount_subtotal, 0) + COALESCE(p_tax_amount, 0) > COALESCE(p_amount_total, 0) + 1
        OR COALESCE(p_amount_subtotal, 0) > COALESCE(p_amount_total, 0) + 1
      )
      THEN GREATEST(COALESCE(p_amount_total, 0) - COALESCE(p_tax_amount, 0), 0)
    WHEN COALESCE(p_amount_subtotal, 0) > 0
      THEN COALESCE(p_amount_subtotal, 0)
    ELSE GREATEST(COALESCE(p_amount_total, 0) - COALESCE(p_tax_amount, 0), 0)
  END;

  INSERT INTO public.proposals (
    org_id,
    type,
    status,
    created_by,
    payload,
    description,
    policy_ref,
    approvals,
    required_approvals,
    executed_at,
    executed_by,
    document_id,
    site_id,
    idempotency_key
  )
  VALUES (
    p_org_id,
    'income.create',
    'executed',
    jsonb_build_object(
      'type', 'human',
      'id', p_actor_user_id,
      'name', p_actor_name
    ),
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'transition_status', 'posted_canonical_projection',
      'source_route', 'accounting.sales.adjust',
      'source_idempotency_key', p_idempotency_key,
      'site_id', p_site_id,
      'client_id', p_client_id,
      'description', v_description,
      'recorded_date', p_recorded_date,
      'amount_subtotal', p_amount_subtotal,
      'tax_amount', p_tax_amount,
      'amount_total', p_amount_total,
      'tax_category', p_tax_category,
      'source_document_id', p_source_document_id,
      'input_sources', COALESCE(p_input_sources, '{}'::jsonb),
      'items', COALESCE(p_items, '[]'::jsonb)
    ),
    '売上登録: ' || v_description,
    'legacy_direct_transition',
    '[]'::jsonb,
    0,
    now(),
    jsonb_build_object(
      'type', 'human',
      'id', p_actor_user_id,
      'name', p_actor_name
    ),
    p_source_document_id,
    p_site_id,
    'accounting.sales.adjust:' || p_idempotency_key
  )
  RETURNING id
  INTO v_proposal_id;

  INSERT INTO public.proposal_executions (
    org_id,
    proposal_id,
    status,
    attempt_no,
    started_at,
    idempotency_key
  )
  VALUES (
    p_org_id,
    v_proposal_id,
    'running',
    1,
    now(),
    'accounting.sales.adjust:' || p_idempotency_key
  )
  RETURNING id
  INTO v_execution_id;

  INSERT INTO public.posting_groups (
    org_id,
    group_type,
    proposal_execution_id,
    accounting_date,
    posted_at,
    currency,
    description
  )
  VALUES (
    p_org_id,
    'manual_adjustment',
    v_execution_id,
    p_recorded_date,
    now(),
    'JPY',
    'Canonical sales posting: ' || v_description
  )
  RETURNING id
  INTO v_posting_group_id;

  INSERT INTO public.accounting_transactions (
    org_id,
    kind,
    cost_center,
    site_id,
    client_id,
    description,
    recorded_date,
    amount_subtotal,
    tax_amount,
    amount_total,
    tax_category,
    status,
    source_document_id,
    input_sources,
    created_by,
    projection_source,
    proposal_id,
    proposal_execution_id,
    posting_group_id,
    legacy_source_route,
    legacy_source_id,
    metadata_json
  )
  VALUES (
    p_org_id,
    'sale',
    'SITE',
    p_site_id,
    p_client_id,
    v_description,
    p_recorded_date,
    p_amount_subtotal,
    p_tax_amount,
    p_amount_total,
    p_tax_category,
    'posted',
    p_source_document_id,
    COALESCE(p_input_sources, '{}'::jsonb),
    p_actor_user_id,
    'canonical_posting_projection',
    v_proposal_id,
    v_execution_id,
    v_posting_group_id,
    'accounting.sales.adjust',
    p_idempotency_key,
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'posting_mode', 'canonical_sales_posting'
    )
  )
  RETURNING id
  INTO v_transaction_id;

  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.accounting_transaction_items (
      org_id,
      transaction_id,
      item_name,
      unit_name,
      unit_price,
      quantity
    )
    SELECT
      p_org_id,
      v_transaction_id,
      COALESCE(NULLIF(item->>'item_name', ''), v_description),
      COALESCE(NULLIF(item->>'unit_name', ''), '式'),
      COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(item->>'quantity', '')::numeric, 1)
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item;
  END IF;

  INSERT INTO public.accounting_journal_entries (
    org_id,
    transaction_id,
    posting_group_id,
    entry_date,
    memo,
    created_by
  )
  VALUES (
    p_org_id,
    v_transaction_id,
    v_posting_group_id,
    p_recorded_date,
    v_description,
    p_actor_user_id
  )
  RETURNING id
  INTO v_journal_entry_id;

  INSERT INTO public.accounting_journal_lines (
    org_id,
    entry_id,
    line_no,
    account_code,
    account_name,
    debit,
    credit,
    description,
    site_id,
    counterparty_id
  )
  VALUES (
    p_org_id,
    v_journal_entry_id,
    v_line_no,
    '1200',
    '売掛金',
    p_amount_total,
    0,
    v_description,
    p_site_id,
    p_client_id
  );

  v_line_no := v_line_no + 1;

  INSERT INTO public.accounting_journal_lines (
    org_id,
    entry_id,
    line_no,
    account_code,
    account_name,
    debit,
    credit,
    tax_rate,
    tax_type,
    description,
    site_id,
    counterparty_id
  )
  VALUES (
    p_org_id,
    v_journal_entry_id,
    v_line_no,
    '4100',
    '売上高',
    0,
    v_sales_amount,
    CASE
      WHEN p_tax_category = '10_STANDARD' THEN 0.10
      WHEN p_tax_category = '08_REDUCED' THEN 0.08
      ELSE 0
    END,
    CASE
      WHEN p_tax_category = '00_EXEMPT' THEN 'exempt'
      WHEN p_tax_category = '00_TAXFREE' THEN 'taxfree'
      ELSE 'taxable'
    END,
    v_description,
    p_site_id,
    p_client_id
  );

  IF COALESCE(p_tax_amount, 0) > 0 THEN
    v_line_no := v_line_no + 1;

    INSERT INTO public.accounting_journal_lines (
      org_id,
      entry_id,
      line_no,
      account_code,
      account_name,
      debit,
      credit,
      description,
      site_id,
      counterparty_id
    )
    VALUES (
      p_org_id,
      v_journal_entry_id,
      v_line_no,
      '2500',
      '仮受消費税',
      0,
      p_tax_amount,
      v_description,
      p_site_id,
      p_client_id
    );
  END IF;

  PERFORM private.assert_accounting_journal_entry_balanced(v_journal_entry_id);

  UPDATE public.accounting_journal_entries
  SET posted_at = now()
  WHERE org_id = p_org_id
    AND id = v_journal_entry_id;

  UPDATE public.accounting_transactions
  SET journal_entry_id = v_journal_entry_id
  WHERE org_id = p_org_id
    AND id = v_transaction_id
  RETURNING *
  INTO v_transaction;

  UPDATE public.proposal_executions
  SET status = 'succeeded',
      finished_at = now(),
      result_json = jsonb_build_object(
        'transaction_id', v_transaction_id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id,
        'projection_source', 'canonical_posting_projection'
      )
  WHERE org_id = p_org_id
    AND id = v_execution_id
  RETURNING *
  INTO v_existing_execution;

  SELECT proposal.*
  INTO v_proposal
  FROM public.proposals AS proposal
  WHERE proposal.org_id = p_org_id
    AND proposal.id = v_proposal_id;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'transaction', to_jsonb(v_transaction),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'type', v_proposal.type,
      'status', 'posted_canonical_projection',
      'db_status', v_proposal.status,
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.sales.adjust',
      'source_idempotency_key', p_idempotency_key
    ),
    'execution', to_jsonb(v_existing_execution),
    'posting_group_id', v_posting_group_id,
    'journal_entry_id', v_journal_entry_id,
    'projection', jsonb_build_object(
      'legacy_transaction_id', v_transaction.id,
      'legacy_transaction_kind', v_transaction.kind,
      'projection_source', v_transaction.projection_source,
      'proposal_id', v_transaction.proposal_id,
      'proposal_execution_id', v_transaction.proposal_execution_id,
      'posting_group_id', v_transaction.posting_group_id,
      'journal_entry_id', v_transaction.journal_entry_id
    ),
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'canonical_sales_posting',
      'affects_pl', true,
      'affects_revenue', true,
      'affects_ar', true
    ),
    'rpc_membership_verified', true
  );
EXCEPTION
  WHEN others THEN
    IF v_execution_id IS NOT NULL THEN
      UPDATE public.proposal_executions
      SET status = 'failed',
          finished_at = now(),
          error_code = SQLSTATE,
          error_message = SQLERRM
      WHERE org_id = p_org_id
        AND id = v_execution_id;
    END IF;

    RAISE;
END;
$$;
