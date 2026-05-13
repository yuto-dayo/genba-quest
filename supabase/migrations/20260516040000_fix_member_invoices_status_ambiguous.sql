-- fix: column reference "status" is ambiguous in member_invoices RPCs
-- ============================================================
-- 既存の 2 RPC は RETURNS TABLE に `status` 列を宣言しているため、
-- PL/pgSQL スコープ内で `org_memberships.status` を裸の `status` で参照すると
-- OUT 列と衝突して `42702 column reference "status" is ambiguous` を投げる。
--
-- 対象:
--   - rpc_org_invoices_outstanding_summary       (20260515000000_member_invoices.sql)
--   - rpc_org_invoices_admin_actionable_list     (20260516000000_member_invoices_paid_void.sql)
--
-- 修正方針: org_memberships に `om` エイリアスを付け、`om.status = 'active'` で明示する。

CREATE OR REPLACE FUNCTION public.rpc_org_invoices_outstanding_summary(
    p_org_id uuid
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
    v_membership_role text;
BEGIN
    SELECT om.role INTO v_membership_role
    FROM public.org_memberships AS om
    WHERE om.org_id = p_org_id
      AND om.user_id = auth.uid()
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

CREATE OR REPLACE FUNCTION public.rpc_org_invoices_admin_actionable_list(
    p_org_id uuid,
    p_status text DEFAULT 'issued',
    p_limit integer DEFAULT 50
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
    v_role text;
BEGIN
    SELECT om.role INTO v_role
    FROM public.org_memberships AS om
    WHERE om.org_id = p_org_id
      AND om.user_id = auth.uid()
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
