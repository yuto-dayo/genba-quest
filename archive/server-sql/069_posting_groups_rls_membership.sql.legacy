-- ============================================================
-- Replace posting_groups JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read posting_groups" ON public.posting_groups;
DROP POLICY IF EXISTS "Insert posting_groups" ON public.posting_groups;

CREATE POLICY "Read posting_groups"
ON public.posting_groups
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert posting_groups"
ON public.posting_groups
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));
