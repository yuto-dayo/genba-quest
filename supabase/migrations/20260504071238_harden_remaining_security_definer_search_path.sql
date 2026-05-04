-- Harden remaining baseline SECURITY DEFINER functions with an explicit
-- search_path. This is a forward fix for remote-current functions adopted by
-- the baseline; function bodies are intentionally unchanged.

ALTER FUNCTION public.accounting_audit_trigger()
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.accounting_auto_assign_reviewer()
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.capture_path_evaluation_finalize()
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.capture_path_reward_snapshot()
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.complete_site_rpc(uuid, uuid, uuid, timestamp with time zone)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.find_proposal_id_by_idempotency_key(uuid, text)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.reject_proposal_atomic(uuid, uuid, jsonb, text)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.reverse_site_completion_rpc(uuid, uuid, uuid, timestamp with time zone, text)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.rpc_next_invoice_no(date)
  SET search_path TO public, pg_temp;
