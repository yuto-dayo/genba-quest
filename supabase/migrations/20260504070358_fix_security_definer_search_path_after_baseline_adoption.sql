-- Fix SECURITY DEFINER search_path that was not changed by the string-based
-- baseline lint migration on remote pg_get_functiondef output.

ALTER FUNCTION public.approve_proposal_atomic(uuid, uuid, jsonb, text)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.assert_reward_write_allowed(uuid, text, text, jsonb)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.execute_proposal_atomic(uuid, uuid, jsonb)
  SET search_path TO public, pg_temp;
