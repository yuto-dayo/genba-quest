-- v2.2 P0 follow-up: party/org boundary helpers for canonical posting RPCs.
--
-- Canonical RPCs accept party identifiers (p_customer_id / p_client_id /
-- p_claimant_member_id) but did not verify that the referenced row belongs to
-- the same org as p_org_id. service_role-bypassed RLS made these IDs trusted
-- by default, which leaked across orgs when an RPC was called directly with a
-- foreign id. These helpers centralise the boundary check so every canonical
-- RPC can fail closed with a stable error code before any write happens.
--
-- Both helpers are no-ops when the party id is NULL (callers pass NULL when
-- the field is optional, e.g. cash sales without a customer).

CREATE OR REPLACE FUNCTION private.assert_customer_belongs_to_org(
  p_customer_id uuid,
  p_org_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'ORG_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.clients
  WHERE id = p_customer_id
    AND org_id = p_org_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_IN_ORG'
      USING ERRCODE = '02000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_member_belongs_to_org(
  p_member_id uuid,
  p_org_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p_member_id IS NULL THEN
    RETURN;
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'ORG_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.org_memberships
  WHERE id = p_member_id
    AND org_id = p_org_id
    AND status = 'active'
    AND suspended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_IN_ORG'
      USING ERRCODE = '02000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_customer_belongs_to_org(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.assert_member_belongs_to_org(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.assert_customer_belongs_to_org(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.assert_member_belongs_to_org(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION private.assert_customer_belongs_to_org(uuid, uuid)
  IS 'Asserts that public.clients.id belongs to p_org_id and is not soft-deleted. No-op when p_customer_id is NULL.';
COMMENT ON FUNCTION private.assert_member_belongs_to_org(uuid, uuid)
  IS 'Asserts that public.org_memberships.id belongs to p_org_id with status=active and is not suspended. No-op when p_member_id is NULL.';
