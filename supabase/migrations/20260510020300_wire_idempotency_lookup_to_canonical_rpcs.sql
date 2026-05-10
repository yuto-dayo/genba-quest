-- v2.2 P1 follow-up: wire canonical posting RPCs to use the new
-- private.find_idempotent_execution helper instead of inlining the
-- proposal_executions SELECT ... FOR UPDATE.
--
-- Behaviour is identical: the helper returns SETOF and the callers keep
-- using SELECT INTO + IF FOUND. Centralising the lookup means future
-- changes to locking, key format, or retention apply uniformly to every
-- canonical posting RPC.

-- Source: 20260510020100_wire_party_org_boundary_to_canonical_rpcs.sql :: rpc_post_accounting_expense_canonical
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

  SELECT *
  INTO v_existing_execution
  FROM private.find_idempotent_execution(
    p_org_id,
    'accounting.expenses.create',
    p_idempotency_key
  );

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

-- Source: 20260510020100_wire_party_org_boundary_to_canonical_rpcs.sql :: rpc_record_accounting_payment_event_canonical
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

  SELECT *
  INTO v_existing_execution
  FROM private.find_idempotent_execution(
    p_org_id,
    'accounting.payments.create',
    p_idempotency_key
  );

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

-- Source: 20260510020100_wire_party_org_boundary_to_canonical_rpcs.sql :: rpc_post_accounting_sale_canonical
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

  SELECT *
  INTO v_existing_execution
  FROM private.find_idempotent_execution(
    p_org_id,
    'accounting.sales.adjust',
    p_idempotency_key
  );

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

-- Source: 20260509113639_canonical_sales_reversal_rpc.sql :: rpc_reverse_accounting_sale_canonical
CREATE OR REPLACE FUNCTION public.rpc_reverse_accounting_sale_canonical(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_idempotency_key text,
  p_transaction_id uuid,
  p_reason text,
  p_reversal_date date DEFAULT CURRENT_DATE,
  p_actor_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_original public.accounting_transactions%ROWTYPE;
  v_reversal public.accounting_transactions%ROWTYPE;
  v_existing_reversal public.accounting_transactions%ROWTYPE;
  v_existing_execution record;
  v_proposal public.proposals%ROWTYPE;
  v_proposal_id uuid;
  v_execution_id uuid;
  v_posting_group_id uuid;
  v_journal_entry_id uuid;
  v_line_no integer := 1;
  v_sales_amount numeric;
  v_tax_amount numeric;
  v_total_amount numeric;
  v_description text;
BEGIN
  PERFORM private.assert_rpc_active_membership(
    p_org_id,
    p_actor_user_id,
    p_membership_id
  );

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'TRANSACTION_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REVERSAL_REASON_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_existing_execution
  FROM private.find_idempotent_execution(
    p_org_id,
    'accounting.void.create',
    p_idempotency_key
  );

  IF FOUND THEN
    SELECT transaction.*
    INTO v_reversal
    FROM public.accounting_transactions AS transaction
    WHERE transaction.org_id = p_org_id
      AND transaction.proposal_execution_id = v_existing_execution.id
      AND transaction.voids_transaction_id = p_transaction_id
    ORDER BY transaction.created_at DESC
    LIMIT 1;

    SELECT proposal.*
    INTO v_proposal
    FROM public.proposals AS proposal
    WHERE proposal.org_id = p_org_id
      AND proposal.id = v_existing_execution.proposal_id;

    RETURN jsonb_build_object(
      'org_id', p_org_id,
      'original_voided', p_transaction_id,
      'original_reversed', p_transaction_id,
      'reversal_created', v_reversal.id,
      'reversal', to_jsonb(v_reversal),
      'proposal', jsonb_build_object(
        'id', v_proposal.id,
        'type', v_proposal.type,
        'status', 'reversed',
        'db_status', v_proposal.status,
        'lineage_mode', 'transition',
        'lifecycle_engine', 'money_transition',
        'full_proposal_lifecycle', false,
        'source_route', 'accounting.void.create',
        'source_idempotency_key', p_idempotency_key
      ),
      'execution', to_jsonb(v_existing_execution),
      'posting_group_id', v_reversal.posting_group_id,
      'journal_entry_id', v_reversal.journal_entry_id,
      'projection', jsonb_build_object(
        'projection_source', v_reversal.projection_source,
        'legacy_transaction_id', v_reversal.id,
        'reverses_transaction_id', p_transaction_id,
        'proposal_id', v_reversal.proposal_id,
        'proposal_execution_id', v_reversal.proposal_execution_id,
        'posting_group_id', v_reversal.posting_group_id,
        'journal_entry_id', v_reversal.journal_entry_id
      ),
      'posting', jsonb_build_object(
        'status', 'posted',
        'mode', 'canonical_sales_reversal',
        'affects_pl', true,
        'affects_revenue', true,
        'affects_ar', true
      ),
      'rpc_membership_verified', true
    );
  END IF;

  SELECT transaction.*
  INTO v_original
  FROM public.accounting_transactions AS transaction
  WHERE transaction.org_id = p_org_id
    AND transaction.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSACTION_NOT_FOUND'
      USING ERRCODE = '02000';
  END IF;

  IF v_original.kind <> 'sale' THEN
    RAISE EXCEPTION 'CANONICAL_SALES_REVERSE_UNSUPPORTED_KIND'
      USING ERRCODE = '42804',
            DETAIL = format('kind=%s', v_original.kind);
  END IF;

  IF v_original.voids_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'CANONICAL_SALES_REVERSE_REVERSAL_ROW'
      USING ERRCODE = '23514';
  END IF;

  IF v_original.status = 'voided' THEN
    RAISE EXCEPTION 'CANONICAL_SALES_REVERSE_ALREADY_VOIDED'
      USING ERRCODE = '23514';
  END IF;

  IF v_original.status <> ALL (ARRAY['posted', 'approved']::text[]) THEN
    RAISE EXCEPTION 'CANONICAL_SALES_REVERSE_NOT_POSTED'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.accounting_transactions AS existing
    WHERE existing.org_id = p_org_id
      AND existing.voids_transaction_id = p_transaction_id
  ) THEN
    RAISE EXCEPTION 'CANONICAL_SALES_REVERSE_ALREADY_EXISTS'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.accounting_invoice_sources AS source
    WHERE source.org_id = p_org_id
      AND source.source_transaction_id = p_transaction_id
  ) OR EXISTS (
    SELECT 1
    FROM public.accounting_invoices AS invoice
    WHERE invoice.org_id = p_org_id
      AND invoice.source_transaction_id = p_transaction_id
  ) THEN
    RAISE EXCEPTION 'CANONICAL_SALES_REVERSE_INVOICED'
      USING ERRCODE = '23514';
  END IF;

  v_tax_amount := abs(COALESCE(v_original.tax_amount, 0));
  v_total_amount := abs(COALESCE(v_original.amount_total, 0));
  v_sales_amount := CASE
    WHEN v_tax_amount > 0
      AND (
        abs(COALESCE(v_original.amount_subtotal, 0)) <= 0
        OR abs(abs(COALESCE(v_original.amount_subtotal, 0)) - v_total_amount) <= 1
        OR abs(COALESCE(v_original.amount_subtotal, 0)) + v_tax_amount > v_total_amount + 1
        OR abs(COALESCE(v_original.amount_subtotal, 0)) > v_total_amount + 1
      )
      THEN GREATEST(v_total_amount - v_tax_amount, 0)
    WHEN abs(COALESCE(v_original.amount_subtotal, 0)) > 0
      THEN abs(COALESCE(v_original.amount_subtotal, 0))
    ELSE GREATEST(v_total_amount - v_tax_amount, 0)
  END;
  v_description := '【取消】' || COALESCE(v_original.description, '') || ' - ' || btrim(p_reason);

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'CANONICAL_SALES_REVERSE_AMOUNT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

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
    'income.reverse',
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
      'transition_status', 'reversed',
      'source_route', 'accounting.void.create',
      'source_idempotency_key', p_idempotency_key,
      'action', 'reverse_posted',
      'transaction_id', p_transaction_id,
      'reason', p_reason
    ),
    '売上取消: ' || COALESCE(v_original.description, p_transaction_id::text),
    'legacy_direct_transition',
    '[]'::jsonb,
    0,
    now(),
    jsonb_build_object(
      'type', 'human',
      'id', p_actor_user_id,
      'name', p_actor_name
    ),
    v_original.source_document_id,
    v_original.site_id,
    'accounting.void.create:' || p_idempotency_key
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
    'accounting.void.create:' || p_idempotency_key
  )
  RETURNING id
  INTO v_execution_id;

  INSERT INTO public.posting_groups (
    org_id,
    group_type,
    proposal_execution_id,
    reverses_posting_group_id,
    accounting_date,
    posted_at,
    currency,
    description
  )
  VALUES (
    p_org_id,
    'manual_adjustment',
    v_execution_id,
    v_original.posting_group_id,
    p_reversal_date,
    now(),
    COALESCE(v_original.currency, 'JPY'),
    'Canonical sales reversal: ' || COALESCE(v_original.description, p_transaction_id::text)
  )
  RETURNING id
  INTO v_posting_group_id;

  INSERT INTO public.accounting_transactions (
    org_id,
    kind,
    cost_center,
    site_id,
    client_id,
    vendor_name,
    description,
    recorded_date,
    amount_subtotal,
    tax_amount,
    amount_total,
    category,
    status,
    voids_transaction_id,
    tax_category,
    source_document_id,
    input_sources,
    voided_by,
    voided_at,
    void_reason,
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
    v_original.kind,
    v_original.cost_center,
    v_original.site_id,
    v_original.client_id,
    v_original.vendor_name,
    v_description,
    p_reversal_date,
    -abs(COALESCE(v_original.amount_subtotal, 0)),
    -v_tax_amount,
    -v_total_amount,
    v_original.category,
    v_original.status,
    p_transaction_id,
    v_original.tax_category,
    v_original.source_document_id,
    COALESCE(v_original.input_sources, '{}'::jsonb),
    p_actor_user_id,
    now(),
    p_reason,
    p_actor_user_id,
    'canonical_posting_projection',
    v_proposal_id,
    v_execution_id,
    v_posting_group_id,
    'accounting.void.create',
    p_idempotency_key,
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'action', 'reverse_posted',
      'posting_mode', 'canonical_sales_reversal',
      'reverses_transaction_id', p_transaction_id
    )
  )
  RETURNING *
  INTO v_reversal;

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
    v_reversal.id,
    v_posting_group_id,
    p_reversal_date,
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
    counterparty_id
  )
  VALUES (
    p_org_id,
    v_journal_entry_id,
    v_line_no,
    '4100',
    '売上高',
    v_sales_amount,
    0,
    CASE
      WHEN v_original.tax_category = '10_STANDARD' THEN 0.10
      WHEN v_original.tax_category = '08_REDUCED' THEN 0.08
      ELSE 0
    END,
    CASE
      WHEN v_original.tax_category = '00_EXEMPT' THEN 'exempt'
      WHEN v_original.tax_category = '00_TAXFREE' THEN 'taxfree'
      ELSE 'taxable'
    END,
    v_description,
    v_original.site_id,
    v_original.client_id
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
      counterparty_id
    )
    VALUES (
      p_org_id,
      v_journal_entry_id,
      v_line_no,
      '2500',
      '仮受消費税',
      v_tax_amount,
      0,
      v_description,
      v_original.site_id,
      v_original.client_id
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
    counterparty_id
  )
  VALUES (
    p_org_id,
    v_journal_entry_id,
    v_line_no,
    '1200',
    '売掛金',
    0,
    v_total_amount,
    v_description,
    v_original.site_id,
    v_original.client_id
  );

  PERFORM private.assert_accounting_journal_entry_balanced(v_journal_entry_id);

  UPDATE public.accounting_journal_entries
  SET posted_at = now()
  WHERE org_id = p_org_id
    AND id = v_journal_entry_id;

  UPDATE public.accounting_transactions
  SET journal_entry_id = v_journal_entry_id
  WHERE org_id = p_org_id
    AND id = v_reversal.id
  RETURNING *
  INTO v_reversal;

  UPDATE public.proposal_executions
  SET status = 'succeeded',
      finished_at = now(),
      result_json = jsonb_build_object(
        'original_transaction_id', p_transaction_id,
        'reversal_transaction_id', v_reversal.id,
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
    'original_voided', p_transaction_id,
    'original_reversed', p_transaction_id,
    'reversal_created', v_reversal.id,
    'reversal', to_jsonb(v_reversal),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'type', v_proposal.type,
      'status', 'reversed',
      'db_status', v_proposal.status,
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.void.create',
      'source_idempotency_key', p_idempotency_key
    ),
    'execution', to_jsonb(v_existing_execution),
    'posting_group_id', v_posting_group_id,
    'journal_entry_id', v_journal_entry_id,
    'projection', jsonb_build_object(
      'projection_source', v_reversal.projection_source,
      'legacy_transaction_id', v_reversal.id,
      'reverses_transaction_id', p_transaction_id,
      'proposal_id', v_reversal.proposal_id,
      'proposal_execution_id', v_reversal.proposal_execution_id,
      'posting_group_id', v_reversal.posting_group_id,
      'journal_entry_id', v_reversal.journal_entry_id
    ),
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'canonical_sales_reversal',
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

-- Source: 20260509134828_canonical_payment_allocation_posting_rpc.sql :: rpc_allocate_accounting_payment_canonical
CREATE OR REPLACE FUNCTION public.rpc_allocate_accounting_payment_canonical(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_idempotency_key text,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_allocated_on date,
  p_amount numeric,
  p_metadata_json jsonb DEFAULT '{}'::jsonb,
  p_actor_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_invoice public.accounting_invoices%ROWTYPE;
  v_payment public.accounting_payments%ROWTYPE;
  v_updated_payment public.accounting_payments%ROWTYPE;
  v_allocation public.payment_allocations%ROWTYPE;
  v_proposal public.proposals%ROWTYPE;
  v_existing_execution record;
  v_proposal_id uuid;
  v_execution_id uuid;
  v_posting_group_id uuid;
  v_journal_entry_id uuid;
  v_invoice_total numeric;
  v_invoice_allocated_total numeric;
  v_payment_allocated_total numeric;
  v_payment_unapplied numeric;
  v_unapplied_after numeric;
  v_uncollected_after numeric;
  v_allocated_on date;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_actor_user_id, p_membership_id);

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'INVOICE_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_AMOUNT_MUST_BE_POSITIVE'
      USING ERRCODE = '23514';
  END IF;

  v_allocated_on := COALESCE(p_allocated_on, CURRENT_DATE);

  SELECT *
  INTO v_existing_execution
  FROM private.find_idempotent_execution(
    p_org_id,
    'accounting.payments.allocate',
    p_idempotency_key
  );

  IF FOUND THEN
    SELECT allocation.*
    INTO v_allocation
    FROM public.payment_allocations AS allocation
    JOIN public.posting_groups AS posting_group
      ON posting_group.org_id = allocation.org_id
     AND posting_group.id = allocation.posting_group_id
    WHERE allocation.org_id = p_org_id
      AND posting_group.proposal_execution_id = v_existing_execution.id
    ORDER BY allocation.created_at DESC
    LIMIT 1;

    SELECT payment.*
    INTO v_updated_payment
    FROM public.accounting_payments AS payment
    WHERE payment.org_id = p_org_id
      AND payment.id = v_allocation.payment_id;

    SELECT invoice.*
    INTO v_invoice
    FROM public.accounting_invoices AS invoice
    WHERE invoice.org_id = p_org_id
      AND invoice.id = v_allocation.invoice_id;

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

    v_invoice_total := CASE
      WHEN COALESCE(v_invoice.source_summary_snapshot->>'amount_total', '') ~ '^[0-9]+(\\.[0-9]+)?$'
        THEN (v_invoice.source_summary_snapshot->>'amount_total')::numeric
      ELSE NULL
    END;

    SELECT COALESCE(SUM(payment_allocations.allocated_amount), 0)
    INTO v_invoice_allocated_total
    FROM public.payment_allocations
    WHERE org_id = p_org_id
      AND invoice_id = v_invoice.id;

    RETURN jsonb_build_object(
      'org_id', p_org_id,
      'payment', to_jsonb(v_updated_payment),
      'allocation', to_jsonb(v_allocation),
      'invoice', jsonb_build_object(
        'id', v_invoice.id,
        'invoice_no', v_invoice.invoice_no,
        'amount_total', v_invoice_total,
        'allocated_total', v_invoice_allocated_total,
        'uncollected_balance', GREATEST(COALESCE(v_invoice_total, 0) - v_invoice_allocated_total, 0)
      ),
      'proposal', jsonb_build_object(
        'id', v_proposal.id,
        'type', v_proposal.type,
        'status', 'posted_canonical_projection',
        'db_status', v_proposal.status,
        'lineage_mode', 'transition',
        'lifecycle_engine', 'money_transition',
        'full_proposal_lifecycle', false,
        'source_route', 'accounting.payments.allocate',
        'source_idempotency_key', p_idempotency_key
      ),
      'execution', to_jsonb(v_existing_execution),
      'posting_group_id', v_posting_group_id,
      'journal_entry_id', v_journal_entry_id,
      'posting', jsonb_build_object(
        'status', 'posted',
        'mode', 'payment_allocation_no_pl_revenue',
        'affects_pl', false,
        'affects_revenue', false,
        'affects_ar', true
      ),
      'projection', jsonb_build_object(
        'projection_source', 'canonical_posting_projection',
        'legacy_payment_id', v_updated_payment.id,
        'legacy_payment_allocation_id', v_allocation.id,
        'legacy_invoice_id', v_invoice.id,
        'proposal_id', v_proposal.id,
        'proposal_execution_id', v_existing_execution.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id
      ),
      'rpc_membership_verified', true
    );
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.accounting_invoices
  WHERE org_id = p_org_id
    AND id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.accounting_payments
  WHERE org_id = p_org_id
    AND id = p_payment_id
    AND status <> 'voided'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_invoice_total := CASE
    WHEN COALESCE(v_invoice.source_summary_snapshot->>'amount_total', '') ~ '^[0-9]+(\\.[0-9]+)?$'
      THEN (v_invoice.source_summary_snapshot->>'amount_total')::numeric
    ELSE NULL
  END;

  IF v_invoice_total IS NULL OR v_invoice_total <= 0 THEN
    RAISE EXCEPTION 'INVOICE_AMOUNT_UNAVAILABLE'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(payment_allocations.allocated_amount), 0)
  INTO v_invoice_allocated_total
  FROM public.payment_allocations
  WHERE org_id = p_org_id
    AND invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(payment_allocations.allocated_amount), 0)
  INTO v_payment_allocated_total
  FROM public.payment_allocations
  WHERE org_id = p_org_id
    AND payment_id = p_payment_id;

  v_payment_unapplied := LEAST(
    COALESCE(v_payment.unapplied_amount, v_payment.amount - v_payment_allocated_total),
    v_payment.amount - v_payment_allocated_total
  );

  IF v_invoice_allocated_total + p_amount > v_invoice_total + 1 THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_UNCOLLECTED_BALANCE'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount > v_payment_unapplied + 1 THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_UNAPPLIED_BALANCE'
      USING ERRCODE = '23514';
  END IF;

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
    'payment.allocate',
    'executed',
    jsonb_build_object('type', 'human', 'id', p_actor_user_id, 'name', p_actor_name),
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'transition_status', 'posted_canonical_projection',
      'source_route', 'accounting.payments.allocate',
      'source_idempotency_key', p_idempotency_key,
      'payment_id', p_payment_id,
      'invoice_id', p_invoice_id,
      'allocated_on', v_allocated_on,
      'amount', p_amount,
      'posting_mode', 'payment_allocation_no_pl_revenue'
    ),
    '入金消込: ' || p_invoice_id::text,
    'legacy_direct_transition',
    '[]'::jsonb,
    0,
    now(),
    jsonb_build_object('type', 'human', 'id', p_actor_user_id, 'name', p_actor_name),
    'accounting.payments.allocate:' || p_idempotency_key
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
    'accounting.payments.allocate:' || p_idempotency_key
  )
  RETURNING id
  INTO v_execution_id;

  INSERT INTO public.posting_groups (
    org_id,
    group_type,
    proposal_execution_id,
    payment_id,
    invoice_id,
    accounting_date,
    posted_at,
    currency,
    description,
    metadata_json
  )
  VALUES (
    p_org_id,
    'payment_allocation',
    v_execution_id,
    p_payment_id,
    p_invoice_id,
    v_allocated_on,
    now(),
    'JPY',
    'Canonical payment allocation posting: ' || p_invoice_id::text,
    jsonb_build_object(
      'posting_mode', 'payment_allocation_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    )
  )
  RETURNING id
  INTO v_posting_group_id;

  INSERT INTO public.payment_allocations (
    org_id,
    payment_id,
    invoice_id,
    allocated_amount,
    allocated_on,
    posting_group_id,
    created_by,
    metadata_json
  )
  VALUES (
    p_org_id,
    p_payment_id,
    p_invoice_id,
    p_amount,
    v_allocated_on,
    v_posting_group_id,
    p_actor_user_id,
    COALESCE(p_metadata_json, '{}'::jsonb) || jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'posting_mode', 'payment_allocation_no_pl_revenue',
      'source_route', 'accounting.payments.allocate',
      'source_idempotency_key', p_idempotency_key
    )
  )
  RETURNING *
  INTO v_allocation;

  v_unapplied_after := GREATEST(v_payment_unapplied - p_amount, 0);
  v_uncollected_after := GREATEST(v_invoice_total - (v_invoice_allocated_total + p_amount), 0);

  UPDATE public.accounting_payments
  SET unapplied_amount = v_unapplied_after,
      status = CASE
        WHEN v_unapplied_after <= 1 THEN 'allocated'
        ELSE 'partially_allocated'
      END,
      metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
        'last_allocation_id', v_allocation.id,
        'last_allocated_invoice_id', p_invoice_id
      )
  WHERE org_id = p_org_id
    AND id = p_payment_id
  RETURNING *
  INTO v_updated_payment;

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
    v_allocated_on,
    '入金消込',
    p_actor_user_id,
    'payment_allocation',
    v_allocation.id,
    jsonb_build_object('posting_mode', 'payment_allocation_no_pl_revenue')
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
      '2160',
      '未消込入金',
      p_amount,
      0,
      '未消込入金の消込',
      v_payment.customer_id,
      jsonb_build_object('payment_id', p_payment_id, 'allocation_id', v_allocation.id)
    ),
    (
      p_org_id,
      v_journal_entry_id,
      2,
      '1200',
      '売掛金',
      0,
      p_amount,
      '売掛金の消込',
      v_payment.customer_id,
      jsonb_build_object('invoice_id', p_invoice_id, 'allocation_id', v_allocation.id)
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
        'payment_id', v_updated_payment.id,
        'allocation_id', v_allocation.id,
        'invoice_id', v_invoice.id,
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
    'payment', to_jsonb(v_updated_payment),
    'allocation', to_jsonb(v_allocation),
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_no', v_invoice.invoice_no,
      'amount_total', v_invoice_total,
      'allocated_total', v_invoice_allocated_total + p_amount,
      'uncollected_balance', v_uncollected_after
    ),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'type', v_proposal.type,
      'status', 'posted_canonical_projection',
      'db_status', v_proposal.status,
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.payments.allocate',
      'source_idempotency_key', p_idempotency_key
    ),
    'execution', to_jsonb(v_existing_execution),
    'posting_group_id', v_posting_group_id,
    'journal_entry_id', v_journal_entry_id,
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'payment_allocation_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    ),
    'projection', jsonb_build_object(
      'projection_source', 'canonical_posting_projection',
      'legacy_payment_id', v_updated_payment.id,
      'legacy_payment_allocation_id', v_allocation.id,
      'legacy_invoice_id', v_invoice.id,
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

-- Source: 20260509135652_canonical_invoice_transfer_posting_rpc.sql :: rpc_create_accounting_invoice_canonical
CREATE OR REPLACE FUNCTION public.rpc_create_accounting_invoice_canonical(
  p_org_id uuid,
  p_source_transaction_ids uuid[],
  p_representative_transaction_id uuid,
  p_document_type text,
  p_issue_date date,
  p_due_date date,
  p_source_transaction_date date,
  p_billing_name text,
  p_billing_address text,
  p_issuer_registration_no text,
  p_notes text,
  p_issuer_snapshot jsonb,
  p_registration_number_snapshot text,
  p_registered_at_snapshot date,
  p_tax_summary_snapshot jsonb,
  p_source_summary_snapshot jsonb,
  p_eligibility_snapshot jsonb,
  p_created_by uuid,
  p_membership_id uuid,
  p_idempotency_key text,
  p_actor_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_base_result jsonb;
  v_invoice public.accounting_invoices%ROWTYPE;
  v_proposal public.proposals%ROWTYPE;
  v_existing_execution record;
  v_execution_id uuid;
  v_posting_group_id uuid;
  v_journal_entry_id uuid;
  v_request_signature jsonb;
  v_contract_asset_amount numeric := 0;
  v_unbilled_amount numeric := 0;
  v_transfer_amount numeric := 0;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_created_by, p_membership_id);

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  v_request_signature := jsonb_build_object(
    'source_transaction_ids', to_jsonb(p_source_transaction_ids),
    'representative_transaction_id', p_representative_transaction_id,
    'document_type', p_document_type,
    'issue_date', p_issue_date,
    'due_date', p_due_date,
    'source_transaction_date', p_source_transaction_date,
    'billing_name', p_billing_name
  );

  SELECT *
  INTO v_existing_execution
  FROM private.find_idempotent_execution(
    p_org_id,
    'accounting.invoices.create',
    p_idempotency_key
  );

  IF FOUND THEN
    IF v_existing_execution.status <> 'succeeded' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_%', upper(v_existing_execution.status)
        USING ERRCODE = '55P03';
    END IF;

    IF COALESCE(v_existing_execution.result_json->'request_signature', '{}'::jsonb) <> v_request_signature THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;

    SELECT invoice.*
    INTO v_invoice
    FROM public.accounting_invoices AS invoice
    WHERE invoice.org_id = p_org_id
      AND invoice.id = (v_existing_execution.result_json->>'invoice_id')::uuid;

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
      'invoice', to_jsonb(v_invoice),
      'source_summary', COALESCE(p_source_summary_snapshot, '{}'::jsonb),
      'proposal', jsonb_build_object(
        'id', v_proposal.id,
        'type', v_proposal.type,
        'status', 'posted_canonical_projection',
        'db_status', v_proposal.status,
        'lineage_mode', 'transition',
        'lifecycle_engine', 'money_transition',
        'full_proposal_lifecycle', false,
        'source_route', 'accounting.invoices.create',
        'source_idempotency_key', p_idempotency_key
      ),
      'execution', to_jsonb(v_existing_execution),
      'posting_group_id', v_posting_group_id,
      'journal_entry_id', v_journal_entry_id,
      'posting', jsonb_build_object(
        'status', CASE WHEN v_posting_group_id IS NULL THEN 'not_required' ELSE 'posted' END,
        'mode', 'invoice_issue_no_pl_revenue',
        'affects_pl', false,
        'affects_revenue', false,
        'affects_ar', true
      ),
      'projection', jsonb_build_object(
        'projection_source', 'canonical_posting_projection',
        'legacy_invoice_id', v_invoice.id,
        'legacy_transaction_id', v_invoice.transaction_id,
        'source_transaction_ids', p_source_transaction_ids,
        'proposal_id', v_proposal.id,
        'proposal_execution_id', v_existing_execution.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id
      ),
      'rpc_membership_verified', true
    );
  END IF;

  v_base_result := public.rpc_create_accounting_invoice(
    p_org_id,
    p_source_transaction_ids,
    p_representative_transaction_id,
    p_document_type,
    p_issue_date,
    p_due_date,
    p_source_transaction_date,
    p_billing_name,
    p_billing_address,
    p_issuer_registration_no,
    p_notes,
    p_issuer_snapshot,
    p_registration_number_snapshot,
    p_registered_at_snapshot,
    p_tax_summary_snapshot,
    p_source_summary_snapshot,
    p_eligibility_snapshot,
    p_created_by,
    p_membership_id
  );

  SELECT invoice.*
  INTO v_invoice
  FROM public.accounting_invoices AS invoice
  WHERE invoice.org_id = p_org_id
    AND invoice.id = (v_base_result->'invoice'->>'id')::uuid
  FOR UPDATE;

  UPDATE public.accounting_invoice_line_revenue_allocations AS allocation
  SET metadata_json = COALESCE(allocation.metadata_json, '{}'::jsonb) || jsonb_build_object(
    'posting_mode', 'invoice_issue_no_pl_revenue'
  )
  WHERE allocation.org_id = p_org_id
    AND allocation.invoice_id = v_invoice.id;

  SELECT
    COALESCE(SUM(allocation.amount_inc_tax) FILTER (
      WHERE allocation.metadata_json->>'receivable_account_type' = 'contract_asset'
    ), 0),
    COALESCE(SUM(allocation.amount_inc_tax) FILTER (
      WHERE allocation.metadata_json->>'receivable_account_type' = 'unbilled_receivable'
    ), 0)
  INTO v_contract_asset_amount, v_unbilled_amount
  FROM public.accounting_invoice_line_revenue_allocations AS allocation
  WHERE allocation.org_id = p_org_id
    AND allocation.invoice_id = v_invoice.id;

  v_transfer_amount := COALESCE(v_contract_asset_amount, 0) + COALESCE(v_unbilled_amount, 0);

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
    'invoice.create',
    'executed',
    jsonb_build_object('type', 'human', 'id', p_created_by, 'name', p_actor_name),
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'transition_status', 'posted_canonical_projection',
      'source_route', 'accounting.invoices.create',
      'source_idempotency_key', p_idempotency_key,
      'invoice_id', v_invoice.id,
      'invoice_no', v_invoice.invoice_no,
      'customer_name', p_billing_name,
      'document_type', p_document_type,
      'issue_date', p_issue_date,
      'due_date', p_due_date,
      'source_transaction_ids', p_source_transaction_ids,
      'source_summary', COALESCE(p_source_summary_snapshot, '{}'::jsonb),
      'eligibility', COALESCE(p_eligibility_snapshot, '{}'::jsonb),
      'posting_mode', 'invoice_issue_no_pl_revenue',
      'transfer_amount', v_transfer_amount
    ),
    '請求書発行: ' || p_billing_name,
    'legacy_direct_transition',
    '[]'::jsonb,
    0,
    now(),
    jsonb_build_object('type', 'human', 'id', p_created_by, 'name', p_actor_name),
    'accounting.invoices.create:' || p_idempotency_key
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
    'accounting.invoices.create:' || p_idempotency_key
  )
  RETURNING id
  INTO v_execution_id;

  IF v_transfer_amount > 0 THEN
    INSERT INTO public.posting_groups (
      org_id,
      group_type,
      proposal_execution_id,
      invoice_id,
      accounting_date,
      posted_at,
      currency,
      description,
      metadata_json
    )
    VALUES (
      p_org_id,
      'invoice_transfer',
      v_execution_id,
      v_invoice.id,
      p_issue_date,
      now(),
      'JPY',
      'Canonical invoice transfer posting: ' || v_invoice.invoice_no,
      jsonb_build_object(
        'posting_mode', 'invoice_issue_no_pl_revenue',
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
      p_issue_date,
      '請求書発行BS振替',
      p_created_by,
      'invoice_transfer',
      v_invoice.id,
      jsonb_build_object('posting_mode', 'invoice_issue_no_pl_revenue')
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
    VALUES (
      p_org_id,
      v_journal_entry_id,
      1,
      '1200',
      '売掛金',
      v_transfer_amount,
      0,
      '請求書発行による売掛金振替',
      NULL,
      jsonb_build_object('invoice_id', v_invoice.id)
    );

    IF v_contract_asset_amount > 0 THEN
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
      VALUES (
        p_org_id,
        v_journal_entry_id,
        2,
        '1220',
        '契約資産',
        0,
        v_contract_asset_amount,
        '契約資産から売掛金への振替',
        NULL,
        jsonb_build_object('invoice_id', v_invoice.id)
      );
    END IF;

    IF v_unbilled_amount > 0 THEN
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
      VALUES (
        p_org_id,
        v_journal_entry_id,
        CASE WHEN v_contract_asset_amount > 0 THEN 3 ELSE 2 END,
        '1210',
        '未請求売掛金',
        0,
        v_unbilled_amount,
        '未請求売掛金から売掛金への振替',
        NULL,
        jsonb_build_object('invoice_id', v_invoice.id)
      );
    END IF;

    PERFORM private.assert_accounting_journal_entry_balanced(v_journal_entry_id);

    UPDATE public.accounting_journal_entries
    SET posted_at = now()
    WHERE org_id = p_org_id
      AND id = v_journal_entry_id;
  END IF;

  UPDATE public.proposal_executions
  SET status = 'succeeded',
      finished_at = now(),
      result_json = jsonb_build_object(
        'invoice_id', v_invoice.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id,
        'projection_source', 'canonical_posting_projection',
        'transfer_amount', v_transfer_amount,
        'request_signature', v_request_signature
      )
  WHERE org_id = p_org_id
    AND id = v_execution_id
  RETURNING *
  INTO v_existing_execution;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'invoice', to_jsonb(v_invoice),
    'source_summary', COALESCE(p_source_summary_snapshot, '{}'::jsonb),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'type', v_proposal.type,
      'status', 'posted_canonical_projection',
      'db_status', v_proposal.status,
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.invoices.create',
      'source_idempotency_key', p_idempotency_key
    ),
    'execution', to_jsonb(v_existing_execution),
    'posting_group_id', v_posting_group_id,
    'journal_entry_id', v_journal_entry_id,
    'posting', jsonb_build_object(
      'status', CASE WHEN v_transfer_amount > 0 THEN 'posted' ELSE 'not_required' END,
      'mode', 'invoice_issue_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true,
      'transfer_amount', v_transfer_amount
    ),
    'projection', jsonb_build_object(
      'projection_source', 'canonical_posting_projection',
      'legacy_invoice_id', v_invoice.id,
      'legacy_transaction_id', v_invoice.transaction_id,
      'source_transaction_ids', p_source_transaction_ids,
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
