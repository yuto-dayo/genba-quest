-- P1 canonical posting entrypoint for immediately posted Money expenses.
--
-- Review-pending expenses stay on the legacy transition path until the
-- approval/execution lifecycle is migrated. This RPC covers the low-risk
-- posted path and preserves accounting_transactions as a compatibility
-- projection.

INSERT INTO public.account_master (
  code,
  name,
  category,
  parent_code,
  is_active,
  display_order,
  description
)
VALUES
  ('1120', '普通預金', 'asset', NULL, true, 120, 'Money v2.2 canonical expense bank settlement account'),
  ('2120', '未払金', 'liability', NULL, true, 120, 'Money v2.2 canonical expense unpaid settlement account'),
  ('2140', 'メンバー立替未払金', 'liability', NULL, true, 140, 'Money v2.2 member reimbursement payable account'),
  ('5900', 'その他経費', 'expense', '5100', true, 190, 'Money v2.2 fallback expense account')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

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

REVOKE ALL ON FUNCTION public.rpc_post_accounting_expense_canonical(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  date,
  numeric,
  numeric,
  numeric,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  text,
  uuid,
  text,
  text,
  text,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_post_accounting_expense_canonical(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  date,
  numeric,
  numeric,
  numeric,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  text,
  uuid,
  text,
  text,
  text,
  uuid,
  text
) TO service_role;

COMMENT ON FUNCTION public.rpc_post_accounting_expense_canonical(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  date,
  numeric,
  numeric,
  numeric,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  text,
  uuid,
  text,
  text,
  text,
  uuid,
  text
) IS 'Creates transition expense.create lineage, proposal execution, posting group, balanced journal, and accounting_transactions projection for immediately posted Money expenses.';
