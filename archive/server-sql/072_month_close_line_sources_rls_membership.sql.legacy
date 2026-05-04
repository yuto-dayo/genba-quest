-- ============================================================
-- Replace month_close_line_sources JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read month_close_line_sources" ON public.month_close_line_sources;
DROP POLICY IF EXISTS "Insert month_close_line_sources" ON public.month_close_line_sources;
DROP POLICY IF EXISTS "Update month_close_line_sources" ON public.month_close_line_sources;

CREATE POLICY "Read month_close_line_sources"
ON public.month_close_line_sources
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert month_close_line_sources"
ON public.month_close_line_sources
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update month_close_line_sources"
ON public.month_close_line_sources
FOR UPDATE TO authenticated
USING (private.is_active_member(org_id))
WITH CHECK (private.is_active_member(org_id));
