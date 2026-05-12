-- Phase 2-2b: member_invoices に支払い / 取り消し を加える
-- ============================================================
-- 発行時: Dr 外注費 / Cr 未払金 (accrual)
-- 支払時: Dr 未払金 / Cr 現金
-- 取消時: 逆仕訳 Dr 未払金 / Cr 外注費 (発行時 entry を打ち消す)
--
-- 監視 UI は引き続き作らない。admin が「払う対象を選ぶ」ためだけに最低限の
-- 行アクション可能リスト (invoice_id / invoice_no / amount / status のみ) を返す。
-- snapshot_bank / member_id 等の PII は admin にも露出しない。

-- --- 1. account_master に未払金 / 外注費 を追加 -------------------
INSERT INTO public.account_master (
    code,
    name,
    category,
    parent_code,
    is_active,
    display_order,
    description
)
VALUES
    -- 未払金: 役務・経費に対する未払債務 (買掛金=2100 は仕入用なので分ける)
    ('2110', '未払金', 'liability', NULL, true, 110,
     '個人事業主 / 外注先への未払債務 (役務提供の対価)'),
    -- 外注費: 個人事業主・下請けへの支払い (発生時に費用認識)
    ('5600', '外注費', 'expense', NULL, true, 600,
     '個人事業主・下請けへの支払い (発生時に費用認識)')
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    parent_code = EXCLUDED.parent_code,
    is_active = EXCLUDED.is_active,
    display_order = EXCLUDED.display_order,
    description = EXCLUDED.description;

-- --- 2. member_invoices に paid / void 関連カラムを追加 -------------
ALTER TABLE public.member_invoices
    ADD COLUMN IF NOT EXISTS paid_at timestamptz,
    ADD COLUMN IF NOT EXISTS paid_proposal_id uuid,
    ADD COLUMN IF NOT EXISTS paid_method text,
    ADD COLUMN IF NOT EXISTS void_at timestamptz,
    ADD COLUMN IF NOT EXISTS void_proposal_id uuid,
    ADD COLUMN IF NOT EXISTS void_reason text;

-- 同じ proposal から複数回 mark_paid / void が走らないように unique
CREATE UNIQUE INDEX IF NOT EXISTS member_invoices_paid_proposal_unique
    ON public.member_invoices (paid_proposal_id)
    WHERE paid_proposal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS member_invoices_void_proposal_unique
    ON public.member_invoices (void_proposal_id)
    WHERE void_proposal_id IS NOT NULL;

-- 状態と column の整合性 (paid なら paid_at / paid_proposal_id 必須、void も同じ)
ALTER TABLE public.member_invoices
    ADD CONSTRAINT member_invoices_paid_consistency_check
        CHECK (
            (status <> 'paid' AND paid_at IS NULL AND paid_proposal_id IS NULL)
            OR
            (status = 'paid' AND paid_at IS NOT NULL AND paid_proposal_id IS NOT NULL)
        ),
    ADD CONSTRAINT member_invoices_void_consistency_check
        CHECK (
            (status <> 'void' AND void_at IS NULL AND void_proposal_id IS NULL)
            OR
            (status = 'void' AND void_at IS NOT NULL AND void_proposal_id IS NOT NULL)
        );

-- proposal への FK (CASCADE は意図的にしない: proposal を消しても請求書実体は残す)
ALTER TABLE public.member_invoices
    ADD CONSTRAINT member_invoices_paid_proposal_fk
        FOREIGN KEY (paid_proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL,
    ADD CONSTRAINT member_invoices_void_proposal_fk
        FOREIGN KEY (void_proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;

-- --- 3. admin 向け「行アクション可能リスト」 ----------------------
-- 個別 invoice を指して mark_paid するために最低限の id + 金額 + 状態を返す。
-- member_id / snapshot_bank / snapshot_address 等 PII は意図的に絞る。
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
    SELECT role INTO v_role
    FROM public.org_memberships
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND status = 'active'
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

REVOKE ALL ON FUNCTION public.rpc_org_invoices_admin_actionable_list(uuid, text, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_org_invoices_admin_actionable_list(uuid, text, integer)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_org_invoices_admin_actionable_list(uuid, text, integer) IS
    'admin が支払い対象を選ぶための最小情報リスト (PII を含まない)。member_id / snapshot は返さない。';

COMMENT ON COLUMN public.member_invoices.paid_at IS
    'invoice.member_mark_paid Proposal が executed になった時点の支払日時。';
COMMENT ON COLUMN public.member_invoices.paid_proposal_id IS
    'mark_paid を発火させた Proposal の id (監査トレイル用)。';
COMMENT ON COLUMN public.member_invoices.void_at IS
    'invoice.member_void Proposal が executed になった時点の取り消し日時。';
COMMENT ON COLUMN public.member_invoices.void_proposal_id IS
    'void を発火させた Proposal の id (監査トレイル用)。';
COMMENT ON COLUMN public.member_invoices.void_reason IS
    '本人が取り消した理由。空文字は不可 (アプリ側でガード)。';
