-- ============================================================
-- Replace month_closes JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read month_closes" ON public.month_closes;
DROP POLICY IF EXISTS "Insert month_closes" ON public.month_closes;
DROP POLICY IF EXISTS "Update month_closes" ON public.month_closes;

CREATE POLICY "Read month_closes"
ON public.month_closes
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert month_closes"
ON public.month_closes
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update month_closes"
ON public.month_closes
FOR UPDATE TO authenticated
USING (private.is_active_member(org_id))
WITH CHECK (private.is_active_member(org_id));
