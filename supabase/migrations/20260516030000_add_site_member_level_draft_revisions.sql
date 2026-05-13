-- Track all member-initiated revisions to V3.3 level drafts.
-- - Created when a member edits their own draft via the PATH page (PR4).
-- - Not created for the initial submission (covered by site_member_level_drafts.submitted_at).
-- - Not created for system-driven changes such as objection acceptance
--   (objection table already audits those).

CREATE TABLE IF NOT EXISTS public.site_member_level_draft_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    draft_id uuid NOT NULL REFERENCES public.site_member_level_drafts(id) ON DELETE CASCADE,
    revised_by uuid NOT NULL,
    revised_at timestamptz NOT NULL DEFAULT now(),
    prev_tier smallint NOT NULL CHECK (prev_tier IN (1, 2, 3)),
    new_tier smallint NOT NULL CHECK (new_tier IN (1, 2, 3)),
    prev_self_comment text NOT NULL DEFAULT '',
    new_self_comment text NOT NULL DEFAULT '',
    reason text NOT NULL CHECK (char_length(reason) > 0 AND char_length(reason) <= 500)
);

CREATE INDEX IF NOT EXISTS site_member_level_draft_revisions_draft_idx
  ON public.site_member_level_draft_revisions(draft_id, revised_at DESC);

CREATE INDEX IF NOT EXISTS site_member_level_draft_revisions_org_idx
  ON public.site_member_level_draft_revisions(org_id, revised_at DESC);

ALTER TABLE public.site_member_level_draft_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read their org revisions"
  ON public.site_member_level_draft_revisions
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM public.org_memberships
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

GRANT SELECT ON public.site_member_level_draft_revisions TO authenticated;
GRANT ALL ON public.site_member_level_draft_revisions TO service_role;

-- rollback hint:
-- DROP TABLE IF EXISTS public.site_member_level_draft_revisions;
