-- v2.2 P0 follow-up: harden legacy accounting base RPC search_path.
--
-- These old base RPCs are still kept for compatibility or internal wrapper use.
-- Do not revoke service_role in this migration: the membership-aware wrappers
-- and canonical RPCs must keep replay compatibility while the transition is in
-- progress. Direct anon/authenticated execution was already revoked in earlier
-- P0 hardening migrations.

ALTER FUNCTION public.rpc_create_accounting_invoice(
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
) SET search_path TO 'pg_catalog';

ALTER FUNCTION public.rpc_record_accounting_payment_allocation(
  uuid,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  uuid,
  jsonb
) SET search_path TO 'pg_catalog';

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
) IS 'Legacy base invoice creation RPC retained for membership-wrapper/canonical internal compatibility. search_path hardened; new server routes should use the membership-aware or canonical overload.';

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
) IS 'Legacy base create-and-allocate payment RPC retained for compatibility only. search_path hardened; new server routes should use payment event plus allocation RPCs.';
