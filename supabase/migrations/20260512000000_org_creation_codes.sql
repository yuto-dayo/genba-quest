-- Invite-code-gated org creation.
-- Replaces the env-var-allowlist + one-shot bootstrap_first_org flow with a
-- consumable code that any authenticated user can redeem to create a new org.

CREATE TABLE IF NOT EXISTS public.org_creation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  notes text,
  CONSTRAINT org_creation_codes_max_uses_positive CHECK (max_uses > 0),
  CONSTRAINT org_creation_codes_used_count_valid CHECK (used_count >= 0 AND used_count <= max_uses)
);

CREATE UNIQUE INDEX IF NOT EXISTS org_creation_codes_code_lower_idx
  ON public.org_creation_codes (lower(code));

CREATE INDEX IF NOT EXISTS org_creation_codes_expires_at_idx
  ON public.org_creation_codes (expires_at);

ALTER TABLE public.org_creation_codes ENABLE ROW LEVEL SECURITY;
-- No client policies. Codes are managed via service_role only.

CREATE TABLE IF NOT EXISTS public.org_creation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  code_id uuid REFERENCES public.org_creation_codes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_creation_log_org_id_idx ON public.org_creation_log (org_id);
CREATE INDEX IF NOT EXISTS org_creation_log_user_id_idx ON public.org_creation_log (user_id);

ALTER TABLE public.org_creation_log ENABLE ROW LEVEL SECURITY;
-- service_role only.

-- Atomic: consume one use of a code AND create org + admin membership in one
-- transaction. If org insert fails, code consumption rolls back automatically.
CREATE OR REPLACE FUNCTION public.create_org_with_code(
  p_user_id uuid,
  p_name text,
  p_code text,
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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  v_normalized_code text := lower(btrim(coalesce(p_code, '')));
  v_code_row public.org_creation_codes%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_constraint_name text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ORG_CREATION_USER_REQUIRED';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'ORG_BOOTSTRAP_NAME_REQUIRED';
  END IF;

  IF v_normalized_code = '' THEN
    RAISE EXCEPTION 'ORG_CREATION_CODE_REQUIRED';
  END IF;

  -- Lock the code row to prevent races on used_count.
  SELECT * INTO v_code_row
  FROM public.org_creation_codes
  WHERE lower(code) = v_normalized_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORG_CREATION_CODE_INVALID';
  END IF;

  IF v_code_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'ORG_CREATION_CODE_REVOKED';
  END IF;

  IF v_code_row.expires_at IS NOT NULL AND v_code_row.expires_at < now() THEN
    RAISE EXCEPTION 'ORG_CREATION_CODE_EXPIRED';
  END IF;

  IF v_code_row.used_count >= v_code_row.max_uses THEN
    RAISE EXCEPTION 'ORG_CREATION_CODE_EXHAUSTED';
  END IF;

  UPDATE public.org_creation_codes
  SET used_count = used_count + 1
  WHERE id = v_code_row.id;

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

  INSERT INTO public.org_creation_log (org_id, user_id, code_id)
  VALUES (v_org.id, p_user_id, v_code_row.id);

  RETURN QUERY
  SELECT
    v_org.id,
    v_org.name,
    v_org.slug,
    v_org.status,
    v_org.id,
    p_user_id,
    'admin'::text,
    'active'::text;
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IN ('organizations_slug_key', 'organizations_slug_lower_idx') THEN
      RAISE EXCEPTION 'ORG_BOOTSTRAP_SLUG_CONFLICT';
    END IF;
    RAISE;
END;
$$;

ALTER FUNCTION public.create_org_with_code(uuid, text, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.create_org_with_code(uuid, text, text, text) IS
  'Consume one use of an org creation code and create an organization + admin membership atomically.';

REVOKE ALL ON FUNCTION public.create_org_with_code(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_org_with_code(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_org_with_code(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_org_with_code(uuid, text, text, text) TO service_role;
