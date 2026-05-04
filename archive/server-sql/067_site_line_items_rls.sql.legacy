-- ============================================================
-- Protect site_line_items behind RLS
-- ============================================================
-- site_line_items belongs to a site and should inherit visibility
-- from the parent site's org membership.

ALTER TABLE public.site_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_line_items" ON public.site_line_items;
DROP POLICY IF EXISTS "Insert site_line_items" ON public.site_line_items;
DROP POLICY IF EXISTS "Update site_line_items" ON public.site_line_items;
DROP POLICY IF EXISTS "Delete site_line_items" ON public.site_line_items;

CREATE POLICY "Read site_line_items" ON public.site_line_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sites site
      WHERE site.id = site_id
        AND private.is_active_member(site.org_id)
    )
  );

CREATE POLICY "Insert site_line_items" ON public.site_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sites site
      WHERE site.id = site_id
        AND private.is_active_member(site.org_id)
    )
  );

CREATE POLICY "Update site_line_items" ON public.site_line_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sites site
      WHERE site.id = site_id
        AND private.is_active_member(site.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sites site
      WHERE site.id = site_id
        AND private.is_active_member(site.org_id)
    )
  );

CREATE POLICY "Delete site_line_items" ON public.site_line_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sites site
      WHERE site.id = site_id
        AND private.is_active_member(site.org_id)
    )
  );
