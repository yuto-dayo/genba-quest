-- P1 canonical reversal entrypoint for posted sales transactions.
--
-- This is intentionally sales-only. Expense reversal remains on the legacy
-- projection path until the expense canonical posting RPC is introduced.

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

  SELECT execution.*
  INTO v_existing_execution
  FROM public.proposal_executions AS execution
  WHERE execution.org_id = p_org_id
    AND execution.idempotency_key = 'accounting.void.create:' || p_idempotency_key
  FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.rpc_reverse_accounting_sale_canonical(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  date,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_reverse_accounting_sale_canonical(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  date,
  text
) TO service_role;

COMMENT ON FUNCTION public.rpc_reverse_accounting_sale_canonical(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  date,
  text
) IS 'Creates transition income.reverse lineage, proposal execution, posting group, balanced reversal journal, and accounting_transactions projection for posted sales reversals.';
