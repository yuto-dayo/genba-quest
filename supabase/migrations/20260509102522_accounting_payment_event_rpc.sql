-- Accounting v2.2 payment event separation.
--
-- POST /payments records the cash receipt root first. Invoice allocation stays
-- in /payments/allocations and must not create PL revenue.

ALTER TABLE public.accounting_write_idempotency_keys
  DROP CONSTRAINT IF EXISTS accounting_write_idempotency_endpoint_check;

ALTER TABLE public.accounting_write_idempotency_keys
  ADD CONSTRAINT accounting_write_idempotency_endpoint_check
  CHECK (endpoint_name = ANY (ARRAY[
    'accounting.expenses.create',
    'accounting.sales.adjust',
    'accounting.invoices.create',
    'accounting.payments.create',
    'accounting.payments.allocate',
    'accounting.void.create',
    'site.close.finalize'
  ]));

CREATE OR REPLACE FUNCTION public.rpc_record_accounting_payment_event(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_received_on date,
  p_amount numeric,
  p_customer_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_account text DEFAULT NULL,
  p_external_reference text DEFAULT NULL,
  p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_payment public.accounting_payments%ROWTYPE;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_actor_user_id, p_membership_id);

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
      'source_route', 'accounting.payments.create',
      'posting_mode', 'payment_received_no_pl_revenue',
      'unapplied_account_type', 'unapplied_cash'
    )
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'payment_received_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    ),
    'projection', jsonb_build_object(
      'projection_source', 'transition_lineage',
      'legacy_payment_id', v_payment.id
    )
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_record_accounting_payment_event(
  uuid,
  uuid,
  uuid,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  jsonb
)
  IS 'Records a cash receipt payment event without allocating it to invoices or creating PL revenue.';

REVOKE ALL ON FUNCTION public.rpc_record_accounting_payment_event(
  uuid,
  uuid,
  uuid,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_record_accounting_payment_event(
  uuid,
  uuid,
  uuid,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  jsonb
) TO service_role;
