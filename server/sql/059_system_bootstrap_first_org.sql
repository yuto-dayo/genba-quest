-- ============================================================
-- 059: System bootstrap for the first organization
-- ============================================================
-- 目的:
--   1) システム内の最初の organization を専用 endpoint から作成する
--   2) organizations count = 0 を SQL 側でも強制する
--   3) concurrent bootstrap でも 2件目が作られないよう保護する
-- ============================================================

DROP FUNCTION IF EXISTS public.bootstrap_first_org(uuid, text, text);

CREATE OR REPLACE FUNCTION public.bootstrap_first_org(
  p_user_id uuid,
  p_name text,
  p_slug text DEFAULT NULL
)
RETURNS TABLE (
  org_id uuid,
  org_name text,
  org_slug text,
  org_status text,
  membership_org_id uuid,
  membership_user_id uuid,
  membership_role text,
  membership_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(59001);

  IF EXISTS (
    SELECT 1
    FROM public.organizations
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'SYSTEM_BOOTSTRAP_ALREADY_COMPLETED';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.bootstrap_org(p_user_id, p_name, p_slug);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%ORG_BOOTSTRAP_NAME_REQUIRED%' THEN
      RAISE EXCEPTION 'SYSTEM_BOOTSTRAP_NAME_REQUIRED';
    END IF;

    IF SQLERRM LIKE '%ORG_BOOTSTRAP_SLUG_CONFLICT%' THEN
      RAISE EXCEPTION 'SYSTEM_BOOTSTRAP_SLUG_CONFLICT';
    END IF;

    RAISE;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_first_org(uuid, text, text) IS
  'Bootstrap the very first organization in the system exactly once.';
