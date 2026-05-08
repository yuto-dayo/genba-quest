-- P0.5 invoice allocation invariant.
-- Keep invoice issuance from allocating more than the recognized revenue_basis
-- amount. The route has a preflight check for UX, but the DB trigger is the
-- canonical guard against concurrent invoice creates.

CREATE OR REPLACE FUNCTION private.assert_invoice_revenue_allocation_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_cap numeric;
  v_allocated numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT revenue_basis.amount_inc_tax
  INTO v_cap
  FROM public.revenue_basis
  WHERE revenue_basis.org_id = NEW.org_id
    AND revenue_basis.id = NEW.revenue_basis_id
  FOR UPDATE;

  IF NOT FOUND OR v_cap IS NULL OR v_cap <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(allocation.amount_inc_tax), 0)
  INTO v_allocated
  FROM public.accounting_invoice_line_revenue_allocations AS allocation
  WHERE allocation.org_id = NEW.org_id
    AND allocation.revenue_basis_id = NEW.revenue_basis_id
    AND allocation.id <> NEW.id;

  v_allocated := v_allocated + COALESCE(NEW.amount_inc_tax, 0);

  IF v_allocated > v_cap + 1 THEN
    RAISE EXCEPTION 'INVOICE_ALLOCATION_EXCEEDS_UNINVOICED_BALANCE'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.assert_invoice_revenue_allocation_capacity()
  IS 'Serializes invoice allocations per revenue_basis and rejects allocations beyond recognized amount_inc_tax.';

DROP TRIGGER IF EXISTS accounting_invoice_allocations_capacity_guard
  ON public.accounting_invoice_line_revenue_allocations;

CREATE TRIGGER accounting_invoice_allocations_capacity_guard
  BEFORE INSERT OR UPDATE OF org_id, revenue_basis_id, amount_inc_tax
  ON public.accounting_invoice_line_revenue_allocations
  FOR EACH ROW
  EXECUTE FUNCTION private.assert_invoice_revenue_allocation_capacity();

CREATE OR REPLACE FUNCTION public.rpc_record_accounting_payment_allocation(
  p_org_id uuid,
  p_invoice_id uuid,
  p_received_on date,
  p_amount numeric,
  p_payment_method text DEFAULT NULL,
  p_payment_account text DEFAULT NULL,
  p_external_reference text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_invoice public.accounting_invoices%ROWTYPE;
  v_invoice_total numeric;
  v_allocated_total numeric;
  v_payment public.accounting_payments%ROWTYPE;
  v_allocation public.payment_allocations%ROWTYPE;
  v_client_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MUST_BE_POSITIVE'
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
  INTO v_allocated_total
  FROM public.payment_allocations
  WHERE org_id = p_org_id
    AND invoice_id = p_invoice_id;

  IF v_allocated_total + p_amount > v_invoice_total + 1 THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_UNCOLLECTED_BALANCE'
      USING ERRCODE = '23514';
  END IF;

  v_client_id := CASE
    WHEN COALESCE(v_invoice.source_summary_snapshot->>'client_id', '') ~* '^[0-9a-fA-F-]{36}$'
      THEN (v_invoice.source_summary_snapshot->>'client_id')::uuid
    ELSE NULL
  END;

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
    v_client_id,
    p_received_on,
    p_amount,
    0,
    'JPY',
    p_payment_method,
    p_payment_account,
    p_external_reference,
    'allocated',
    p_created_by,
    COALESCE(p_metadata_json, '{}'::jsonb) || jsonb_build_object(
      'invoice_id', p_invoice_id,
      'posting_mode', 'no_pl_journal'
    )
  )
  RETURNING * INTO v_payment;

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
    v_payment.id,
    p_invoice_id,
    p_amount,
    p_received_on,
    NULL,
    p_created_by,
    jsonb_build_object('posting_mode', 'no_pl_journal')
  )
  RETURNING * INTO v_allocation;

  RETURN jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'allocation', to_jsonb(v_allocation),
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_no', v_invoice.invoice_no,
      'amount_total', v_invoice_total,
      'allocated_total', v_allocated_total + p_amount,
      'uncollected_balance', GREATEST(v_invoice_total - (v_allocated_total + p_amount), 0)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  uuid,
  jsonb
)
  IS 'Atomically records a payment and allocates it to an invoice without creating PL revenue.';

REVOKE ALL ON FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  uuid,
  jsonb
) TO service_role;
