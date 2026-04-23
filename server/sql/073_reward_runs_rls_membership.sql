-- ============================================================
-- Replace reward_runs JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read reward_runs" ON public.reward_runs;
DROP POLICY IF EXISTS "Insert reward_runs" ON public.reward_runs;
DROP POLICY IF EXISTS "Update reward_runs" ON public.reward_runs;

CREATE POLICY "Read reward_runs"
ON public.reward_runs
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert reward_runs"
ON public.reward_runs
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update reward_runs"
ON public.reward_runs
FOR UPDATE TO authenticated
USING (private.is_active_member(org_id))
WITH CHECK (private.is_active_member(org_id));
