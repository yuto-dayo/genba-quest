-- ============================================================
-- Replace revenue_basis JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read revenue_basis" ON public.revenue_basis;
DROP POLICY IF EXISTS "Insert revenue_basis" ON public.revenue_basis;
DROP POLICY IF EXISTS "Update revenue_basis" ON public.revenue_basis;

CREATE POLICY "Read revenue_basis"
ON public.revenue_basis
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert revenue_basis"
ON public.revenue_basis
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update revenue_basis"
ON public.revenue_basis
FOR UPDATE TO authenticated
USING (private.is_active_member(org_id))
WITH CHECK (private.is_active_member(org_id));
