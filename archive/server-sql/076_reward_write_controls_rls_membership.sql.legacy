-- ============================================================
-- Replace reward_write_controls JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read reward_write_controls" ON public.reward_write_controls;
DROP POLICY IF EXISTS "Manage reward_write_controls" ON public.reward_write_controls;

CREATE POLICY "Read reward_write_controls"
ON public.reward_write_controls
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Manage reward_write_controls"
ON public.reward_write_controls
FOR ALL TO authenticated
USING (
  private.has_org_role(org_id, ARRAY['admin']::text[])
)
WITH CHECK (
  private.has_org_role(org_id, ARRAY['admin']::text[])
);
