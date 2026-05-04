-- ============================================================
-- 056: Org membership foundation
-- ============================================================
-- 目的:
--   1) org を所属の正本として導入する
--   2) org_memberships / org_invites を分離し、招待状態を invite 側へ寄せる
--   3) 後続 migration で使う private RLS helper を先に用意する
-- メモ:
--   - backfill と既存テーブルの RLS 置換は 057 で行う
--   - DEFAULT_ORG_ID は互換期間の seed としてのみ扱う
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'removed')),
  title text,
  approval_limit numeric,
  joined_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.org_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email_normalized text NOT NULL
    CHECK (email_normalized = lower(btrim(email_normalized))),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_status_idx
  ON public.organizations (status);

CREATE INDEX IF NOT EXISTS org_memberships_org_status_idx
  ON public.org_memberships (org_id, status);

CREATE INDEX IF NOT EXISTS org_memberships_user_status_idx
  ON public.org_memberships (user_id, status);

CREATE INDEX IF NOT EXISTS org_memberships_org_role_status_idx
  ON public.org_memberships (org_id, role, status);

CREATE INDEX IF NOT EXISTS org_invites_org_email_status_idx
  ON public.org_invites (org_id, email_normalized, status);

CREATE UNIQUE INDEX IF NOT EXISTS org_invites_active_email_idx
  ON public.org_invites (org_id, email_normalized)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS org_invites_token_hash_idx
  ON public.org_invites (token_hash);

DROP TRIGGER IF EXISTS organizations_set_updated_at ON public.organizations;
CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS org_memberships_set_updated_at ON public.org_memberships;
CREATE TRIGGER org_memberships_set_updated_at
BEFORE UPDATE ON public.org_memberships
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS org_invites_set_updated_at ON public.org_invites;
CREATE TRIGGER org_invites_set_updated_at
BEFORE UPDATE ON public.org_invites
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.organizations (id, slug, name, status)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'default-org',
  'Default Organization',
  'active'
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.is_active_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.has_org_role(p_org_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.role = ANY (p_roles)
  );
$$;

REVOKE ALL ON FUNCTION private.is_active_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_org_role(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_active_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_active_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.has_org_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_org_role(uuid, text[]) TO service_role;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Organizations" ON public.organizations;
DROP POLICY IF EXISTS "Update Organizations" ON public.organizations;
DROP POLICY IF EXISTS "Read Own Org Memberships" ON public.org_memberships;
DROP POLICY IF EXISTS "Read Org Invites As Admin" ON public.org_invites;
DROP POLICY IF EXISTS "Insert Org Invites As Admin" ON public.org_invites;
DROP POLICY IF EXISTS "Update Org Invites As Admin" ON public.org_invites;

CREATE POLICY "Read Organizations" ON public.organizations
  FOR SELECT TO authenticated
  USING (private.is_active_member(id));

CREATE POLICY "Update Organizations" ON public.organizations
  FOR UPDATE TO authenticated
  USING (private.has_org_role(id, ARRAY['admin']::text[]))
  WITH CHECK (private.has_org_role(id, ARRAY['admin']::text[]));

CREATE POLICY "Read Own Org Memberships" ON public.org_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Read Org Invites As Admin" ON public.org_invites
  FOR SELECT TO authenticated
  USING (private.has_org_role(org_id, ARRAY['admin']::text[]));

CREATE POLICY "Insert Org Invites As Admin" ON public.org_invites
  FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(org_id, ARRAY['admin']::text[]));

CREATE POLICY "Update Org Invites As Admin" ON public.org_invites
  FOR UPDATE TO authenticated
  USING (private.has_org_role(org_id, ARRAY['admin']::text[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['admin']::text[]));
