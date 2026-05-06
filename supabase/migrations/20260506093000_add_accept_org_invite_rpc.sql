CREATE OR REPLACE FUNCTION public.accept_org_invite(
  p_invite_id uuid,
  p_user_id uuid,
  p_email text
) RETURNS TABLE(
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
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_invite public.org_invites%ROWTYPE;
  v_org public.organizations%ROWTYPE;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'ORG_INVITE_EMAIL_REQUIRED';
  END IF;

  SELECT *
  INTO v_invite
  FROM public.org_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORG_INVITE_NOT_FOUND';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'ORG_INVITE_NOT_PENDING';
  END IF;

  IF v_invite.expires_at < now() THEN
    UPDATE public.org_invites
    SET status = 'expired'
    WHERE id = v_invite.id
      AND status = 'pending';

    RAISE EXCEPTION 'ORG_INVITE_EXPIRED';
  END IF;

  IF v_invite.email_normalized <> v_email THEN
    RAISE EXCEPTION 'ORG_INVITE_EMAIL_MISMATCH';
  END IF;

  INSERT INTO public.org_memberships (
    org_id,
    user_id,
    role,
    status,
    joined_at,
    suspended_at,
    suspended_reason
  )
  VALUES (
    v_invite.org_id,
    p_user_id,
    v_invite.role,
    'active',
    now(),
    null,
    null
  )
  ON CONFLICT (org_id, user_id)
  DO UPDATE SET
    role = excluded.role,
    status = 'active',
    joined_at = coalesce(public.org_memberships.joined_at, excluded.joined_at),
    suspended_at = null,
    suspended_reason = null;

  UPDATE public.org_invites
  SET
    status = 'accepted',
    accepted_by = p_user_id,
    accepted_at = now()
  WHERE id = v_invite.id
    AND status = 'pending';

  SELECT *
  INTO v_org
  FROM public.organizations
  WHERE id = v_invite.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORG_NOT_FOUND';
  END IF;

  RETURN QUERY
  SELECT
    v_org.id,
    v_org.name,
    v_org.slug,
    v_org.status,
    v_invite.org_id,
    p_user_id,
    v_invite.role,
    'active'::text;
END;
$$;

COMMENT ON FUNCTION public.accept_org_invite(uuid, uuid, text) IS 'Accept a pending org invite and create/reactivate membership in one transaction.';

GRANT ALL ON FUNCTION public.accept_org_invite(uuid, uuid, text) TO anon;
GRANT ALL ON FUNCTION public.accept_org_invite(uuid, uuid, text) TO authenticated;
GRANT ALL ON FUNCTION public.accept_org_invite(uuid, uuid, text) TO service_role;
