-- ============================================================
-- Replace focus_items JWT org claim checks with membership checks
-- ============================================================
-- user_metadata is end-user editable and must not be used in RLS.

DROP POLICY IF EXISTS "Read Focus Items" ON public.focus_items;
DROP POLICY IF EXISTS "Insert Focus Items" ON public.focus_items;
DROP POLICY IF EXISTS "Update Focus Items" ON public.focus_items;
DROP POLICY IF EXISTS "Delete Focus Items" ON public.focus_items;

CREATE POLICY "Read Focus Items" ON public.focus_items
  FOR SELECT TO authenticated
  USING (
    private.is_active_member(org_id)
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "Insert Focus Items" ON public.focus_items
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_active_member(org_id)
    AND created_by = auth.uid()
  );

CREATE POLICY "Update Focus Items" ON public.focus_items
  FOR UPDATE TO authenticated
  USING (
    private.is_active_member(org_id)
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  )
  WITH CHECK (
    private.is_active_member(org_id)
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "Delete Focus Items" ON public.focus_items
  FOR DELETE TO authenticated
  USING (
    private.is_active_member(org_id)
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  );
