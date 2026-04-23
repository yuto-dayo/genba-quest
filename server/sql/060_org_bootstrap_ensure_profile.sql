-- ============================================================
-- 060: Ensure profile record during org bootstrap
-- ============================================================
-- 目的:
--   1) 初回ログイン直後で public.profiles が未作成でも org bootstrap を成功させる
--   2) bootstrap_org / bootstrap_first_org の呼び出し元に依存せず FK を自己修復する
-- ============================================================

DROP FUNCTION IF EXISTS public.bootstrap_org(uuid, text, text);

CREATE OR REPLACE FUNCTION public.bootstrap_org(
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
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  v_org organizations%ROWTYPE;
  v_constraint_name text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'ORG_BOOTSTRAP_NAME_REQUIRED';
  END IF;

  INSERT INTO public.profiles (id, updated_at)
  VALUES (p_user_id, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organizations (name, slug, status)
  VALUES (v_name, v_slug, 'active')
  RETURNING * INTO v_org;

  INSERT INTO public.org_memberships (
    org_id,
    user_id,
    role,
    status,
    joined_at
  )
  VALUES (
    v_org.id,
    p_user_id,
    'admin',
    'active',
    now()
  );

  RETURN QUERY
  SELECT
    v_org.id,
    v_org.name,
    v_org.slug,
    v_org.status,
    v_org.id,
    p_user_id,
    'admin',
    'active';
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IN ('organizations_slug_key', 'organizations_slug_lower_idx') THEN
      RAISE EXCEPTION 'ORG_BOOTSTRAP_SLUG_CONFLICT';
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_org(uuid, text, text) IS
  'Bootstrap a first organization and creator membership in one transaction, ensuring the caller profile exists.';
