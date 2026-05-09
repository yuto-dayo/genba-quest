-- Accounting v2.2 existing-payment allocation.
--
-- /payments creates the cash receipt root. /payments/allocations now allocates
-- an existing payment to an invoice and enforces both invoice open balance and
-- payment unapplied balance.

CREATE OR REPLACE FUNCTION public.rpc_allocate_accounting_payment(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_allocated_on date,
  p_amount numeric,
  p_metadata_json jsonb DEFAULT '{}'::jsonb
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
  v_invoice_total numeric;
  v_invoice_allocated_total numeric;
  v_payment_allocated_total numeric;
  v_payment_unapplied numeric;
  v_unapplied_after numeric;
  v_uncollected_after numeric;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_actor_user_id, p_membership_id);

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
    COALESCE(p_allocated_on, CURRENT_DATE),
    NULL,
    p_actor_user_id,
    COALESCE(p_metadata_json, '{}'::jsonb) || jsonb_build_object(
      'posting_mode', 'payment_allocation_no_pl_revenue',
      'source_route', 'accounting.payments.allocate'
    )
  )
  RETURNING * INTO v_allocation;

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
  RETURNING * INTO v_updated_payment;

  RETURN jsonb_build_object(
    'payment', to_jsonb(v_updated_payment),
    'allocation', to_jsonb(v_allocation),
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_no', v_invoice.invoice_no,
      'amount_total', v_invoice_total,
      'allocated_total', v_invoice_allocated_total + p_amount,
      'uncollected_balance', v_uncollected_after
    ),
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'payment_allocation_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    ),
    'projection', jsonb_build_object(
      'projection_source', 'transition_lineage',
      'legacy_payment_id', v_updated_payment.id,
      'legacy_payment_allocation_id', v_allocation.id,
      'legacy_invoice_id', v_invoice.id
    )
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_allocate_accounting_payment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  numeric,
  jsonb
)
  IS 'Allocates an existing payment to an invoice without creating PL revenue.';

REVOKE ALL ON FUNCTION public.rpc_allocate_accounting_payment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  numeric,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_allocate_accounting_payment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  numeric,
  jsonb
) TO service_role;
