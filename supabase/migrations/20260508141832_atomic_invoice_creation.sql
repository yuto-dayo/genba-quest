-- P0.5 atomic invoice creation.
-- The server still builds eligibility/tax/source snapshots, but invoice
-- numbering, invoice insert, source links, revenue allocations, and legacy
-- transaction projection updates happen inside one database transaction.

CREATE OR REPLACE FUNCTION public.rpc_create_accounting_invoice(
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
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_invoice public.accounting_invoices%ROWTYPE;
  v_invoice_no text;
  v_found_count integer;
BEGIN
  IF p_source_transaction_ids IS NULL OR array_length(p_source_transaction_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'SOURCE_TRANSACTION_IDS_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_billing_name IS NULL OR btrim(p_billing_name) = '' THEN
    RAISE EXCEPTION 'BILLING_NAME_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.accounting_transactions AS tx
  WHERE tx.org_id = p_org_id
    AND tx.id = ANY (p_source_transaction_ids)
    AND tx.kind = ANY (ARRAY['sale', 'invoice'])
  FOR UPDATE;
  GET DIAGNOSTICS v_found_count = ROW_COUNT;

  IF v_found_count <> array_length(p_source_transaction_ids, 1) THEN
    RAISE EXCEPTION 'SOURCE_TRANSACTION_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.accounting_invoice_sources AS source
    JOIN public.accounting_invoices AS invoice
      ON invoice.org_id = source.org_id
     AND invoice.id = source.invoice_id
    WHERE source.org_id = p_org_id
      AND source.source_transaction_id = ANY (p_source_transaction_ids)
      AND source.is_primary_document = true
      AND invoice.document_type = ANY (ARRAY['standard_invoice', 'qualified_invoice'])
  ) THEN
    RAISE EXCEPTION 'INVOICE_ALREADY_EXISTS'
      USING ERRCODE = '23505';
  END IF;

  v_invoice_no := public.rpc_next_invoice_no(p_issue_date);

  INSERT INTO public.accounting_invoices (
    org_id,
    transaction_id,
    source_transaction_id,
    invoice_no,
    document_type,
    issue_date,
    due_date,
    source_transaction_date,
    billing_name,
    billing_address,
    issuer_registration_no,
    notes,
    issuer_snapshot,
    registration_number_snapshot,
    registered_at_snapshot,
    tax_summary_snapshot,
    source_summary_snapshot,
    eligibility_snapshot,
    pdf_render_status,
    created_by
  )
  VALUES (
    p_org_id,
    p_representative_transaction_id,
    p_representative_transaction_id,
    v_invoice_no,
    p_document_type,
    p_issue_date,
    p_due_date,
    p_source_transaction_date,
    p_billing_name,
    p_billing_address,
    p_issuer_registration_no,
    p_notes,
    COALESCE(p_issuer_snapshot, '{}'::jsonb),
    p_registration_number_snapshot,
    p_registered_at_snapshot,
    COALESCE(p_tax_summary_snapshot, '{"by_rate":[],"currency":"JPY"}'::jsonb),
    COALESCE(p_source_summary_snapshot, '{}'::jsonb),
    COALESCE(p_eligibility_snapshot, '{}'::jsonb),
    'pending',
    p_created_by
  )
  RETURNING * INTO v_invoice;

  INSERT INTO public.accounting_invoice_sources (
    org_id,
    invoice_id,
    source_transaction_id,
    source_transaction_date,
    sort_order,
    is_primary_document
  )
  SELECT
    p_org_id,
    v_invoice.id,
    tx.id,
    tx.recorded_date,
    source_ids.ordinality - 1,
    true
  FROM unnest(p_source_transaction_ids) WITH ORDINALITY AS source_ids(id, ordinality)
  JOIN public.accounting_transactions AS tx
    ON tx.org_id = p_org_id
   AND tx.id = source_ids.id
  ORDER BY source_ids.ordinality;

  INSERT INTO public.accounting_invoice_line_revenue_allocations (
    org_id,
    invoice_id,
    invoice_line_key,
    revenue_basis_id,
    allocation_amount_ex_tax,
    tax_amount,
    amount_inc_tax,
    allocation_kind,
    created_by,
    metadata_json
  )
  SELECT
    p_org_id,
    v_invoice.id,
    'source_transaction:' || tx.id::text,
    revenue_basis.id,
    CASE
      WHEN ABS(COALESCE(tx.amount_subtotal, 0)) > 0 THEN ABS(COALESCE(tx.amount_subtotal, 0))
      ELSE GREATEST(ABS(COALESCE(tx.amount_total, 0)) - ABS(COALESCE(tx.tax_amount, 0)), 0)
    END,
    ABS(COALESCE(tx.tax_amount, 0)),
    ABS(COALESCE(tx.amount_total, 0)),
    'invoice_issue',
    p_created_by,
    jsonb_build_object(
      'source_transaction_id', tx.id,
      'source_transaction_kind', tx.kind,
      'source_site_id', tx.site_id,
      'recognition_date', COALESCE(revenue_basis.recognized_on, revenue_basis.recognition_date),
      'receivable_account_type', COALESCE(revenue_basis.receivable_account_type, 'accounts_receivable'),
      'posting_mode', 'no_pl_journal'
    )
  FROM unnest(p_source_transaction_ids) WITH ORDINALITY AS source_ids(id, ordinality)
  JOIN public.accounting_transactions AS tx
    ON tx.org_id = p_org_id
   AND tx.id = source_ids.id
  JOIN LATERAL (
    SELECT rb.*
    FROM public.revenue_basis AS rb
    WHERE rb.org_id = p_org_id
      AND rb.site_id = tx.site_id
      AND rb.status = 'active'
    ORDER BY COALESCE(rb.recognized_on, rb.recognition_date) DESC, rb.created_at DESC, rb.id DESC
    LIMIT 1
  ) AS revenue_basis ON true
  WHERE tx.site_id IS NOT NULL
  ORDER BY source_ids.ordinality;

  UPDATE public.accounting_transactions
  SET kind = 'invoice'
  WHERE org_id = p_org_id
    AND id = ANY (p_source_transaction_ids);

  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'source_summary', COALESCE(p_source_summary_snapshot, '{}'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_create_accounting_invoice(
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
  uuid
)
  IS 'Atomically creates an invoice, source links, revenue allocations, and legacy transaction projection updates.';

REVOKE ALL ON FUNCTION public.rpc_create_accounting_invoice(
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
  uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_create_accounting_invoice(
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
  uuid
) TO service_role;
