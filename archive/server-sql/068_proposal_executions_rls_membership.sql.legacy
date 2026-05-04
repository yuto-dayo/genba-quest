-- ============================================================
-- Replace proposal_executions JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read proposal_executions" ON public.proposal_executions;
DROP POLICY IF EXISTS "Insert proposal_executions" ON public.proposal_executions;
DROP POLICY IF EXISTS "Update proposal_executions" ON public.proposal_executions;

CREATE POLICY "Read proposal_executions"
ON public.proposal_executions
FOR SELECT TO authenticated
USING (private.is_active_member(org_id));

CREATE POLICY "Insert proposal_executions"
ON public.proposal_executions
FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Update proposal_executions"
ON public.proposal_executions
FOR UPDATE TO authenticated
USING (private.is_active_member(org_id))
WITH CHECK (private.is_active_member(org_id));
