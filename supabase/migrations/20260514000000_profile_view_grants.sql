-- profile_view_grants: 拡張プロフィール閲覧の本人承認チケット
-- ============================================================
-- DAO 原則: admin は本人の Proposal 承認なしに他メンバーの
-- 拡張情報 (振込先 / インボイス番号 / 住所 / 緊急連絡先) を見られない。
-- profile.view_request Proposal が approved になったときに 1 行発行される。
-- 本人 (target_user_id) はいつでも revoke 可能。
-- admin (requesting_admin_id) は期限内のみ参照可。
--
-- 「admin による監視 UI」は作らない:
--   - 一覧 API は「自分が要求した grant」「自分が承認した grant」のみ返す
--   - admin が他人の grant 状況を覗く API は意図的に存在させない

CREATE TABLE IF NOT EXISTS public.profile_view_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
    target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    requesting_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    purpose text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    revocation_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profile_view_grants_self_grant_check
        CHECK (target_user_id <> requesting_admin_id),
    CONSTRAINT profile_view_grants_expiry_check
        CHECK (expires_at > granted_at),
    CONSTRAINT profile_view_grants_revocation_consistency_check
        CHECK (
            (revoked_at IS NULL AND revoked_by IS NULL) OR
            (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
        ),
    CONSTRAINT profile_view_grants_purpose_nonempty
        CHECK (length(btrim(purpose)) >= 4)
);

CREATE INDEX IF NOT EXISTS profile_view_grants_active_lookup_idx
    ON public.profile_view_grants (org_id, requesting_admin_id, target_user_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS profile_view_grants_target_idx
    ON public.profile_view_grants (target_user_id);

CREATE INDEX IF NOT EXISTS profile_view_grants_proposal_idx
    ON public.profile_view_grants (proposal_id);

ALTER TABLE public.profile_view_grants ENABLE ROW LEVEL SECURITY;

-- 本人 (target) と admin (requesting) のみが自分が関わる grant を読める。
-- 他のメンバー (admin 含む) から見えてはいけない (= 監視防止)。
CREATE POLICY "Read own profile view grants"
    ON public.profile_view_grants FOR SELECT TO authenticated
    USING (
        target_user_id = auth.uid()
        OR requesting_admin_id = auth.uid()
    );

-- INSERT/UPDATE/DELETE は service_role 経由 (= ProposalService / ProfileViewConsentService) のみ。
-- これにより「approve しないで grant 行を作る」「revoked_at を勝手に外す」ような改ざんを防ぐ。

-- 本人視点のチェック関数 (将来のカラム単位 RLS で再利用予定):
-- target_user の拡張情報を viewer_user が現時点で閲覧できるか?
CREATE OR REPLACE FUNCTION private.has_active_profile_view_grant(
    p_target_user_id uuid,
    p_viewer_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profile_view_grants AS grant_row
        WHERE grant_row.target_user_id = p_target_user_id
          AND grant_row.requesting_admin_id = p_viewer_user_id
          AND grant_row.revoked_at IS NULL
          AND grant_row.expires_at > now()
    );
$$;

COMMENT ON TABLE public.profile_view_grants IS
    '拡張プロフィール閲覧の本人承認チケット。admin が振込先等を見るには本人承認の Proposal が必要。';
COMMENT ON COLUMN public.profile_view_grants.target_user_id IS
    '拡張情報を見られる本人 (承認者)。';
COMMENT ON COLUMN public.profile_view_grants.requesting_admin_id IS
    '拡張情報を見たい admin (申請者)。';
COMMENT ON COLUMN public.profile_view_grants.purpose IS
    '閲覧目的。例: "振込エラーの調査のため口座情報を確認したい"。';
COMMENT ON COLUMN public.profile_view_grants.expires_at IS
    '失効時刻。デフォルト granted_at + 24h を想定 (アプリ側で設定)。';
COMMENT ON FUNCTION private.has_active_profile_view_grant(uuid, uuid) IS
    '本人 (target) の拡張情報を viewer が現時点で閲覧できるか判定。grant 行が active かつ未失効ならtrue。';
