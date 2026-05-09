-- P1 canonical posting entrypoint for manual sales adjustments.
--
-- This RPC is the first canonical posting slice for Money sales writes. It
-- keeps the public Money response compatible by still producing an
-- accounting_transactions projection, but the write authority is the
-- proposal/execution/posting_group/journal chain created in one DB
-- transaction.

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

REVOKE ALL ON FUNCTION public.rpc_post_accounting_sale_canonical(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  date,
  numeric,
  numeric,
  numeric,
  text,
  uuid,
  jsonb,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_post_accounting_sale_canonical(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  date,
  numeric,
  numeric,
  numeric,
  text,
  uuid,
  jsonb,
  jsonb,
  text
) TO service_role;

COMMENT ON FUNCTION public.rpc_post_accounting_sale_canonical(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  date,
  numeric,
  numeric,
  numeric,
  text,
  uuid,
  jsonb,
  jsonb,
  text
) IS 'Creates transition proposal lineage, proposal execution, posting group, balanced journal, and accounting_transactions projection for manual sales writes.';
