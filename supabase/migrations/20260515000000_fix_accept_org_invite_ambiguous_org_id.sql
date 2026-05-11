-- =============================================================================
-- Fix: accept_org_invite RPC が "column reference \"org_id\" is ambiguous"
--      で落ちる問題を修正する。
--
-- 症状:
--   招待リンクから入って「参加する」を押すと、サーバーログに次が出る:
--     [ORG] access error: Error: column reference "org_id" is ambiguous
--   フロントは 500 を受けて「招待への参加に失敗しました。時間を置いて再度お試し
--   ください。」 (App.tsx:249 のフォールバック) を表示する。結果として
--   招待受諾フローが一度も成立しない状態だった。
--
-- 原因:
--   既存マイグレーション 20260506093000_add_accept_org_invite_rpc.sql の関数は
--     RETURNS TABLE(org_id uuid, org_name text, ...)
--   と宣言している。PL/pgSQL はこの "org_id" を関数内の OUT 変数として扱う。
--   一方で関数本体には
--     INSERT INTO public.org_memberships (org_id, user_id, ...)
--     ON CONFLICT (org_id, user_id) ...
--   というカラム名 "org_id" を持つ INSERT がある。
--   plpgsql のデフォルト設定 (#variable_conflict error) では、OUT 変数とカラム
--   が同名だと曖昧として実行を拒否する。
--
-- 修正方針:
--   関数本体の冒頭に `#variable_conflict use_column` を追加し、カラム参照を優先
--   させる。OUT 変数名は変更しない (TypeScript 側が payload.org_id /
--   payload.org_name 等の名前で結果を読んでいるため、互換維持)。
--
-- 副作用:
--   CREATE OR REPLACE FUNCTION は権限を保持するので、既存の
--     20260506094251_restrict_accept_org_invite_execute.sql
--     20260506094325_revoke_public_accept_org_invite_execute.sql
--   による REVOKE / GRANT (service_role のみ実行可) はそのまま残る。
-- =============================================================================

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
#variable_conflict use_column
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
