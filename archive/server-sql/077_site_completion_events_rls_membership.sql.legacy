-- ============================================================
-- Replace site_completion_events JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read site_completion_events" ON public.site_completion_events;
DROP POLICY IF EXISTS "Insert site_completion_events" ON public.site_completion_events;

CREATE POLICY "Read site_completion_events"
ON public.site_completion_events
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert site_completion_events"
ON public.site_completion_events
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));
