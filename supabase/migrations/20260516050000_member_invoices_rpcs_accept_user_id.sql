-- feat: member_invoices admin RPCs accept p_user_id explicitly
-- ============================================================
-- 既存の rpc_org_invoices_outstanding_summary / rpc_org_invoices_admin_actionable_list は
-- `auth.uid()` をメンバーシップ判定に使う前提だったが、
-- サーバ側は service_role キー (supabaseAdmin) で呼び出すため `auth.uid()` が NULL となり、
-- 結果として常に `NOT_MEMBER_OF_ORG` が返ってしまっていた。
--
-- App 層の認証ミドルウェア + resolveActiveOrgMembership で既に呼び出しユーザの本人性は確認済みのため、
-- RPC は明示引数 `p_user_id` を受け取り、未指定なら従来通り `auth.uid()` にフォールバックする。
-- 関数本体の admin role チェックは defense-in-depth として残す。

DROP FUNCTION IF EXISTS public.rpc_org_invoices_outstanding_summary(uuid);

CREATE FUNCTION public.rpc_org_invoices_outstanding_summary(
    p_org_id uuid,
    p_user_id uuid DEFAULT NULL
) RETURNS TABLE (
    status text,
    period_month text,
    invoice_count bigint,
    total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_effective_user_id uuid := COALESCE(p_user_id, auth.uid());
    v_membership_role text;
BEGIN
    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_USER_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    SELECT om.role INTO v_membership_role
    FROM public.org_memberships AS om
    WHERE om.org_id = p_org_id
      AND om.user_id = v_effective_user_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_membership_role IS NULL THEN
        RAISE EXCEPTION 'NOT_MEMBER_OF_ORG'
            USING ERRCODE = '42501';
    END IF;

    IF v_membership_role <> 'admin' THEN
        RAISE EXCEPTION 'ADMIN_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        inv.status,
        inv.period_month,
        count(*)::bigint AS invoice_count,
        sum(inv.amount_total)::numeric(15, 2) AS total_amount
    FROM public.member_invoices AS inv
    WHERE inv.org_id = p_org_id
      AND inv.status <> 'void'
    GROUP BY inv.status, inv.period_month
    ORDER BY inv.period_month DESC, inv.status;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_org_invoices_outstanding_summary(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_org_invoices_outstanding_summary(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_org_invoices_outstanding_summary(uuid, uuid) IS
    'admin 向け請求書集計 (PII を含まない)。p_user_id 未指定なら auth.uid() を使用する。';

DROP FUNCTION IF EXISTS public.rpc_org_invoices_admin_actionable_list(uuid, text, integer);

CREATE FUNCTION public.rpc_org_invoices_admin_actionable_list(
    p_org_id uuid,
    p_status text DEFAULT 'issued',
    p_limit integer DEFAULT 50,
    p_user_id uuid DEFAULT NULL
) RETURNS TABLE (
    invoice_id uuid,
    invoice_no text,
    period_month text,
    amount_total numeric,
    status text,
    source text,
    issued_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_effective_user_id uuid := COALESCE(p_user_id, auth.uid());
    v_role text;
BEGIN
    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_USER_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    SELECT om.role INTO v_role
    FROM public.org_memberships AS om
    WHERE om.org_id = p_org_id
      AND om.user_id = v_effective_user_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'NOT_MEMBER_OF_ORG'
            USING ERRCODE = '42501';
    END IF;

    IF v_role <> 'admin' THEN
        RAISE EXCEPTION 'ADMIN_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_status NOT IN ('issued', 'paid', 'void') THEN
        RAISE EXCEPTION 'INVALID_STATUS_FILTER'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        inv.id,
        inv.invoice_no,
        inv.period_month,
        inv.amount_total,
        inv.status,
        inv.source,
        inv.issued_at
    FROM public.member_invoices AS inv
    WHERE inv.org_id = p_org_id
      AND inv.status = p_status
    ORDER BY inv.issued_at DESC
    LIMIT COALESCE(NULLIF(p_limit, 0), 50);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_org_invoices_admin_actionable_list(uuid, text, integer, uuid)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_org_invoices_admin_actionable_list(uuid, text, integer, uuid)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_org_invoices_admin_actionable_list(uuid, text, integer, uuid) IS
    'admin が支払い対象を選ぶための最小情報リスト (PII を含まない)。p_user_id 未指定なら auth.uid() を使用する。';
