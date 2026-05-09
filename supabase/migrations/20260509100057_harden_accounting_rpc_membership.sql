-- P0 SECURITY DEFINER hardening for accounting and site-completion RPCs.
--
-- Existing implementation functions keep their original signatures for
-- backwards-compatible service-role callers, but direct anon/authenticated
-- execution is revoked. New membership-aware overloads are what the server
-- routes call going forward.

CREATE OR REPLACE FUNCTION private.assert_rpc_active_membership(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_membership_id IS NULL THEN
    RAISE EXCEPTION 'RPC_MEMBERSHIP_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.org_memberships AS membership
  WHERE membership.id = p_membership_id
    AND membership.org_id = p_org_id
    AND membership.user_id = p_actor_user_id
    AND membership.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RPC_MEMBERSHIP_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_rpc_active_membership(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.assert_rpc_active_membership(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_site_rpc(
  p_org_id uuid,
  p_site_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_effective_completed_at timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_actor_user_id, p_membership_id);

  v_result := public.complete_site_rpc(
    p_org_id,
    p_site_id,
    p_actor_user_id,
    p_effective_completed_at
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'org_id', p_org_id,
    'membership_id', p_membership_id,
    'rpc_membership_verified', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_site_completion_rpc(
  p_org_id uuid,
  p_site_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_effective_reversed_at timestamp with time zone DEFAULT now(),
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_actor_user_id, p_membership_id);

  v_result := public.reverse_site_completion_rpc(
    p_org_id,
    p_site_id,
    p_actor_user_id,
    p_effective_reversed_at,
    p_reason
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'org_id', p_org_id,
    'membership_id', p_membership_id,
    'rpc_membership_verified', true
  );
END;
$$;

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
  p_created_by uuid,
  p_membership_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_created_by, p_membership_id);

  v_result := public.rpc_create_accounting_invoice(
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
    p_created_by
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'org_id', p_org_id,
    'membership_id', p_membership_id,
    'rpc_membership_verified', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_record_accounting_payment_allocation(
  p_org_id uuid,
  p_membership_id uuid,
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
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_created_by, p_membership_id);

  v_result := public.rpc_record_accounting_payment_allocation(
    p_org_id,
    p_invoice_id,
    p_received_on,
    p_amount,
    p_payment_method,
    p_payment_account,
    p_external_reference,
    p_created_by,
    p_metadata_json
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'org_id', p_org_id,
    'membership_id', p_membership_id,
    'rpc_membership_verified', true
  );
END;
$$;

-- Close direct Data API execution of both legacy and membership-aware RPCs.
REVOKE ALL ON FUNCTION public.complete_site_rpc(uuid, uuid, uuid, timestamp with time zone)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_site_rpc(uuid, uuid, uuid, uuid, timestamp with time zone)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_site_rpc(uuid, uuid, uuid, timestamp with time zone)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_site_rpc(uuid, uuid, uuid, uuid, timestamp with time zone)
  TO service_role;

REVOKE ALL ON FUNCTION public.reverse_site_completion_rpc(uuid, uuid, uuid, timestamp with time zone, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_site_completion_rpc(uuid, uuid, uuid, uuid, timestamp with time zone, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_site_completion_rpc(uuid, uuid, uuid, timestamp with time zone, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_site_completion_rpc(uuid, uuid, uuid, uuid, timestamp with time zone, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.rpc_create_accounting_invoice(
  uuid, uuid[], uuid, text, date, date, date, text, text, text, text, jsonb, text, date, jsonb, jsonb, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_create_accounting_invoice(
  uuid, uuid[], uuid, text, date, date, date, text, text, text, text, jsonb, text, date, jsonb, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_accounting_invoice(
  uuid, uuid[], uuid, text, date, date, date, text, text, text, text, jsonb, text, date, jsonb, jsonb, jsonb, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_accounting_invoice(
  uuid, uuid[], uuid, text, date, date, date, text, text, text, text, jsonb, text, date, jsonb, jsonb, jsonb, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid, uuid, date, numeric, text, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid, uuid, uuid, date, numeric, text, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid, uuid, date, numeric, text, text, text, uuid, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid, uuid, uuid, date, numeric, text, text, text, uuid, jsonb
) TO service_role;
