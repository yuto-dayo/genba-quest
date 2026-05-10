-- v2.2 P1 follow-up: centralise the idempotency lookup used by every
-- canonical posting RPC.
--
-- Before this helper, each canonical RPC inlined the same SELECT ... FOR
-- UPDATE against public.proposal_executions with an endpoint-prefixed
-- idempotency key. The pattern was correct but copy-pasted six times,
-- which makes future changes (locking semantics, key format, retention)
-- harder to apply uniformly. The helper returns SETOF so callers can
-- continue to use SELECT INTO + IF FOUND for the existing-execution check
-- without changing flow control.

CREATE OR REPLACE FUNCTION private.find_idempotent_execution(
  p_org_id uuid,
  p_endpoint text,
  p_idempotency_key text
) RETURNS SETOF public.proposal_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'ORG_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_endpoint IS NULL OR btrim(p_endpoint) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_ENDPOINT_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.proposal_executions
  WHERE org_id = p_org_id
    AND idempotency_key = p_endpoint || ':' || p_idempotency_key
  FOR UPDATE;
END;
$$;

REVOKE ALL ON FUNCTION private.find_idempotent_execution(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.find_idempotent_execution(uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION private.find_idempotent_execution(uuid, text, text)
  IS 'Returns the proposal_executions row (with FOR UPDATE) matching p_endpoint || '':'' || p_idempotency_key for p_org_id, or no rows if none. Centralises the idempotency lookup used by canonical posting RPCs.';
