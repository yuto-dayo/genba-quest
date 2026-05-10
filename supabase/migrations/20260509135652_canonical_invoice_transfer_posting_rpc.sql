-- P1 canonical no-PL-revenue posting for Money invoice issue.
--
-- Invoice issue may transfer contract assets / unbilled receivables to AR,
-- but it must not create PL revenue. If the revenue basis is already AR,
-- the posting is marked not_required while still returning transition lineage.

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
  ('1210', '未請求売掛金', 'asset', NULL, true, 210, 'Money v2.2 unbilled receivable transfer account'),
  ('1220', '契約資産', 'asset', NULL, true, 220, 'Money v2.2 contract asset transfer account')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

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

  SELECT execution.*
  INTO v_existing_execution
  FROM public.proposal_executions AS execution
  WHERE execution.org_id = p_org_id
    AND execution.idempotency_key = 'accounting.invoices.create:' || p_idempotency_key
  FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.rpc_create_accounting_invoice_canonical(
  uuid,
  uuid[],
  uuid,
  text,
  date,
  date,
  date,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  date,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_create_accounting_invoice_canonical(
  uuid,
  uuid[],
  uuid,
  text,
  date,
  date,
  date,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  date,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.rpc_create_accounting_invoice_canonical(
  uuid,
  uuid[],
  uuid,
  text,
  date,
  date,
  date,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  date,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text,
  text
) IS 'Creates an invoice through the atomic invoice RPC, records transition invoice.create lineage, and posts an optional no-PL-revenue invoice_transfer journal when revenue was recognized to contract assets or unbilled receivables.';
