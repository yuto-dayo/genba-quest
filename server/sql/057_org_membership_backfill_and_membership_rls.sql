-- ============================================================
-- 057: Org membership backfill and membership-based RLS
-- ============================================================
-- 目的:
--   1) 既存 profiles を default org membership に backfill する
--   2) sites / clients / communication_* の RLS を membership helper に切り替える
-- メモ:
--   - active org 解決や API 共通認可は後続アプリケーション変更で導入する
--   - DEFAULT_ORG_ID 前提は移行互換のため一時的に残る
-- ============================================================

INSERT INTO public.org_memberships (
  org_id,
  user_id,
  role,
  status,
  approval_limit,
  joined_at,
  created_at,
  updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid AS org_id,
  p.id AS user_id,
  CASE
    WHEN p.role IN ('admin', 'manager') THEN 'admin'
    ELSE 'member'
  END AS role,
  'active' AS status,
  p.approval_limit,
  now() AS joined_at,
  now() AS created_at,
  now() AS updated_at
FROM public.profiles p
ON CONFLICT (org_id, user_id) DO UPDATE
SET
  role = EXCLUDED.role,
  approval_limit = EXCLUDED.approval_limit,
  updated_at = now();

DROP POLICY IF EXISTS "Read Sites" ON public.sites;
DROP POLICY IF EXISTS "Insert Sites" ON public.sites;
DROP POLICY IF EXISTS "Update Sites" ON public.sites;

CREATE POLICY "Read Sites" ON public.sites
  FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Insert Sites" ON public.sites
  FOR INSERT TO authenticated
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update Sites" ON public.sites
  FOR UPDATE TO authenticated
  USING (private.is_active_member(org_id))
  WITH CHECK (private.is_active_member(org_id));

DROP POLICY IF EXISTS "Read Clients" ON public.clients;

CREATE POLICY "Read Clients" ON public.clients
  FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));

DROP POLICY IF EXISTS "Read Communication Conversations" ON public.communication_conversations;
DROP POLICY IF EXISTS "Insert Communication Conversations" ON public.communication_conversations;
DROP POLICY IF EXISTS "Update Communication Conversations" ON public.communication_conversations;
DROP POLICY IF EXISTS "Read Communication Logs" ON public.communication_logs;
DROP POLICY IF EXISTS "Insert Communication Logs" ON public.communication_logs;
DROP POLICY IF EXISTS "Update Communication Logs" ON public.communication_logs;
DROP POLICY IF EXISTS "Read Communication Links" ON public.communication_links;
DROP POLICY IF EXISTS "Insert Communication Links" ON public.communication_links;
DROP POLICY IF EXISTS "Read Communication Participants" ON public.communication_participants;
DROP POLICY IF EXISTS "Insert Communication Participants" ON public.communication_participants;
DROP POLICY IF EXISTS "Update Communication Participants" ON public.communication_participants;

CREATE POLICY "Read Communication Conversations" ON public.communication_conversations
  FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Insert Communication Conversations" ON public.communication_conversations
  FOR INSERT TO authenticated
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update Communication Conversations" ON public.communication_conversations
  FOR UPDATE TO authenticated
  USING (private.is_active_member(org_id))
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Read Communication Logs" ON public.communication_logs
  FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Insert Communication Logs" ON public.communication_logs
  FOR INSERT TO authenticated
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update Communication Logs" ON public.communication_logs
  FOR UPDATE TO authenticated
  USING (private.is_active_member(org_id))
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Read Communication Links" ON public.communication_links
  FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Insert Communication Links" ON public.communication_links
  FOR INSERT TO authenticated
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Read Communication Participants" ON public.communication_participants
  FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Insert Communication Participants" ON public.communication_participants
  FOR INSERT TO authenticated
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update Communication Participants" ON public.communication_participants
  FOR UPDATE TO authenticated
  USING (private.is_active_member(org_id))
  WITH CHECK (private.is_active_member(org_id));
