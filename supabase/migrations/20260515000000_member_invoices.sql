-- member_invoices: 本人主導の請求書 (member → org)
-- ============================================================
-- DAO 原則: 個人事業主 (member) が自分の意思で組織に対して請求書を発行する。
-- admin は「未請求 / 請求済 / 支払済」のラベルと金額集計のみ見られる。
-- 振込先 / インボイス番号 / 住所 は発行時の本人プロフィールから snapshot され、
-- 後続のプロフィール変更に影響されない (法的証跡が必要なため)。
--
-- 「admin による監視 UI」は作らない:
--   - 個別の請求書一覧は本人視点のみ
--   - admin が読めるのは「金額・件数・期間」だけの集計
--   - 監視可能になる範囲は org_invoices_outstanding_summary view で明示する

CREATE TABLE IF NOT EXISTS public.member_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
    member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- どの締めから自動で生成されたか (path_reward / monthly_distribution / manual)
    source text NOT NULL,
    source_ref_id uuid,
    -- 対象月 (YYYY-MM)。同一 member × 同一 source × 同一月の重複発行を防ぐ
    period_month text NOT NULL,
    -- 金額・明細
    amount_total numeric(15, 2) NOT NULL,
    line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- 本人プロフィールからの snapshot (発行時に凍結。後の profile 変更は反映しない)
    snapshot_trade_name text,
    snapshot_invoice_registration_no text,
    snapshot_bank jsonb NOT NULL DEFAULT '{}'::jsonb,
    snapshot_address jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- 状態 (Phase 2-2a では issued のみ。2-2b で paid を追加予定)
    status text NOT NULL DEFAULT 'issued',
    invoice_no text NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT member_invoices_source_check
        CHECK (source = ANY (ARRAY['path_reward', 'monthly_distribution', 'manual'])),
    CONSTRAINT member_invoices_status_check
        CHECK (status = ANY (ARRAY['issued', 'paid', 'void'])),
    CONSTRAINT member_invoices_period_check
        CHECK (period_month ~ '^\d{4}-\d{2}$'),
    CONSTRAINT member_invoices_amount_positive
        CHECK (amount_total > 0)
);

-- 同じ proposal から複数回発行されないことを保証 (冪等性)
CREATE UNIQUE INDEX IF NOT EXISTS member_invoices_proposal_unique
    ON public.member_invoices (proposal_id);

-- 「同じ member が同じ source の同じ月を 2 度発行する」のを防ぐ。
-- void になったものは除外 (再発行を許容)。
CREATE UNIQUE INDEX IF NOT EXISTS member_invoices_active_period_unique
    ON public.member_invoices (org_id, member_id, source, period_month)
    WHERE status <> 'void';

CREATE INDEX IF NOT EXISTS member_invoices_member_idx
    ON public.member_invoices (org_id, member_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS member_invoices_status_idx
    ON public.member_invoices (org_id, status);

CREATE OR REPLACE TRIGGER member_invoices_set_updated_at
    BEFORE UPDATE ON public.member_invoices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.member_invoices ENABLE ROW LEVEL SECURITY;

-- 本人だけが自分の請求書の行 (snapshot 含む) を直接読める。
-- admin であっても、生データ (snapshot_bank / snapshot_address 等) には触れない。
CREATE POLICY "Read own member invoices"
    ON public.member_invoices FOR SELECT TO authenticated
    USING (member_id = auth.uid());

-- INSERT / UPDATE / DELETE は service_role 経由のみ (ProposalService 経由)
-- 直接書き込みを禁止することで「approve 経由でない発行」を構造的に止める。

-- admin が「個人情報なしの集計」を取れる view。
-- 数値・件数・期間だけ露出し、PII は出さない。member_id ですら隠す。
CREATE OR REPLACE VIEW public.org_invoices_outstanding_summary
WITH (security_invoker = true)
AS
SELECT
    inv.org_id,
    inv.status,
    inv.period_month,
    count(*)::bigint AS invoice_count,
    sum(inv.amount_total)::numeric(15, 2) AS total_amount
FROM public.member_invoices AS inv
WHERE inv.status <> 'void'
GROUP BY inv.org_id, inv.status, inv.period_month;

-- view は org_memberships の admin が安全に読める前提。
-- security_invoker により、SELECT する側の auth.uid() の権限で member_invoices に当たる。
-- しかし member_invoices の RLS は「自分の行のみ」許可なので、集計が空になる。
-- 集計目的のため、 admin 用に別関数 (SECURITY DEFINER) を用意する。

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
    SELECT role INTO v_membership_role
    FROM public.org_memberships
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND status = 'active'
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

REVOKE ALL ON FUNCTION public.rpc_org_invoices_outstanding_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_org_invoices_outstanding_summary(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.member_invoices IS
    '本人主導の請求書 (member → org)。発行時に振込先などを snapshot し、その後のプロフィール変更に影響されない。';
COMMENT ON COLUMN public.member_invoices.source IS
    'どの締めから生成されたか (path_reward / monthly_distribution / manual)。';
COMMENT ON COLUMN public.member_invoices.snapshot_bank IS
    '発行時点の振込先情報。bank_name / branch_name / account_type / account_number / account_holder_kana を含む。';
COMMENT ON COLUMN public.member_invoices.snapshot_invoice_registration_no IS
    '発行時点の T番号 (適格請求書発行事業者登録番号)。';
COMMENT ON FUNCTION public.rpc_org_invoices_outstanding_summary(uuid) IS
    'admin 向け請求書集計 (PII を含まない)。status / period_month ごとの件数と総額のみ返す。';
