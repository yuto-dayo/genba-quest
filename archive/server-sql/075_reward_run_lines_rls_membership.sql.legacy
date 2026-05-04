-- ============================================================
-- Replace reward_run_lines JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read reward_run_lines" ON public.reward_run_lines;
DROP POLICY IF EXISTS "Insert reward_run_lines" ON public.reward_run_lines;
DROP POLICY IF EXISTS "Update reward_run_lines" ON public.reward_run_lines;

CREATE POLICY "Read reward_run_lines"
ON public.reward_run_lines
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert reward_run_lines"
ON public.reward_run_lines
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update reward_run_lines"
ON public.reward_run_lines
FOR UPDATE TO authenticated
USING (private.is_active_member(org_id))
WITH CHECK (private.is_active_member(org_id));
