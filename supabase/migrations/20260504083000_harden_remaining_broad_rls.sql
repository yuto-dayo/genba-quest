-- Eliminate the remaining baseline broad RLS predicates.
--
-- Scope:
-- - Badge / Perk / Profile ownership and same-organization visibility.
-- - Parent-derived Monster / Battle access through sites.org_id.
-- - Explicit shared-read predicates for master/reference tables.
-- - Explicit service_role predicates for operational caches.

CREATE OR REPLACE FUNCTION private.can_access_member_profile(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    p_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.org_memberships AS viewer
      JOIN public.org_memberships AS target
        ON target.org_id = viewer.org_id
      WHERE viewer.user_id = auth.uid()
        AND viewer.status = 'active'
        AND target.user_id = p_user_id
        AND target.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION private.can_access_badge_application(p_application_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.badge_applications AS application
    WHERE application.id = p_application_id
      AND private.can_access_member_profile(application.applicant_id)
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_perk_application(p_application_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.perk_applications AS application
    WHERE application.id = p_application_id
      AND private.can_access_member_profile(application.applicant_id)
  );
$$;

COMMENT ON FUNCTION private.can_access_member_profile(uuid)
  IS 'RLS helper: visibility for own profile or members sharing an active organization.';
COMMENT ON FUNCTION private.can_access_badge_application(uuid)
  IS 'RLS helper: badge application visibility through applicant same-organization access.';
COMMENT ON FUNCTION private.can_access_perk_application(uuid)
  IS 'RLS helper: perk application visibility through applicant same-organization access.';

-- Shared reference/master reads. These remain global by design, but no longer use
-- a literal true predicate.
DROP POLICY IF EXISTS "Read Account Master" ON public.account_master;
DROP POLICY IF EXISTS "Read Tax Categories" ON public.tax_categories;
DROP POLICY IF EXISTS "Read trade_families" ON public.trade_families;
DROP POLICY IF EXISTS "monster_archetypes_select" ON public.monster_archetypes;
DROP POLICY IF EXISTS "Read Perk Definitions" ON public.perk_definitions;
DROP POLICY IF EXISTS "Read Feature Flags" ON public.feature_flags;

CREATE POLICY "Read Account Master"
  ON public.account_master
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated' AND is_active IS TRUE);

CREATE POLICY "Read Tax Categories"
  ON public.tax_categories
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Read trade_families"
  ON public.trade_families
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated' AND is_active IS TRUE);

CREATE POLICY "monster_archetypes_select"
  ON public.monster_archetypes
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Read Perk Definitions"
  ON public.perk_definitions
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Read Feature Flags"
  ON public.feature_flags
  FOR SELECT
  TO authenticated
  USING (
    enabled
    AND (
      target_users IS NULL
      OR cardinality(target_users) = 0
      OR auth.uid() = ANY(target_users)
    )
  );

-- Profiles: own profile or same active organization.
DROP POLICY IF EXISTS "Read Profiles" ON public.profiles;

CREATE POLICY "Read Profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (private.can_access_member_profile(id));

-- Badge / Perk state and applications.
DROP POLICY IF EXISTS "Read Badge Applications" ON public.badge_applications;
DROP POLICY IF EXISTS "Update Badge Applications" ON public.badge_applications;
DROP POLICY IF EXISTS "Read Badge Votes" ON public.badge_application_votes;
DROP POLICY IF EXISTS "Upsert Badge States" ON public.badge_states;
DROP POLICY IF EXISTS "Read Badge States" ON public.badge_states;
DROP POLICY IF EXISTS "Update Badge States" ON public.badge_states;
DROP POLICY IF EXISTS "Read Perk Applications" ON public.perk_applications;
DROP POLICY IF EXISTS "Read Perk Votes" ON public.perk_application_votes;
DROP POLICY IF EXISTS "Read Perk States" ON public.perk_states;

CREATE POLICY "Read Badge Applications"
  ON public.badge_applications
  FOR SELECT
  TO authenticated
  USING (private.can_access_member_profile(applicant_id));

CREATE POLICY "Read Badge Votes"
  ON public.badge_application_votes
  FOR SELECT
  TO authenticated
  USING (private.can_access_badge_application(application_id));

CREATE POLICY "Read Badge States"
  ON public.badge_states
  FOR SELECT
  TO authenticated
  USING (private.can_access_member_profile(user_id));

CREATE POLICY "Read Perk Applications"
  ON public.perk_applications
  FOR SELECT
  TO authenticated
  USING (private.can_access_member_profile(applicant_id));

CREATE POLICY "Read Perk Votes"
  ON public.perk_application_votes
  FOR SELECT
  TO authenticated
  USING (private.can_access_perk_application(application_id));

CREATE POLICY "Read Perk States"
  ON public.perk_states
  FOR SELECT
  TO authenticated
  USING (private.can_access_member_profile(user_id));

-- AI proposals and principle observations.
DROP POLICY IF EXISTS "Read AI Proposals" ON public.ai_proposals;
DROP POLICY IF EXISTS "principle_observations_insert" ON public.principle_observations;
DROP POLICY IF EXISTS "principle_observations_select" ON public.principle_observations;

CREATE POLICY "Read AI Proposals"
  ON public.ai_proposals
  FOR SELECT
  TO authenticated
  USING (reviewed_by = auth.uid());

CREATE POLICY "principle_observations_insert"
  ON public.principle_observations
  FOR INSERT
  TO service_role
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "principle_observations_select"
  ON public.principle_observations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.design_principles AS principle
      WHERE principle.id = principle_observations.principle_id
        AND private.is_active_member(principle.org_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.proposals AS proposal
      WHERE proposal.id = principle_observations.proposal_id
        AND private.is_active_member(proposal.org_id)
    )
  );

-- Monster / battle artifacts derive visibility from their parent site org.
DROP POLICY IF EXISTS "battle_log_select" ON public.battle_log;
DROP POLICY IF EXISTS "monster_images_insert" ON public.monster_images;
DROP POLICY IF EXISTS "monster_images_select" ON public.monster_images;
DROP POLICY IF EXISTS "monster_images_update" ON public.monster_images;

CREATE POLICY "battle_log_select"
  ON public.battle_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sites AS site
      WHERE site.id = battle_log.site_id
        AND private.is_active_member(site.org_id)
    )
  );

CREATE POLICY "monster_images_select"
  ON public.monster_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sites AS site
      WHERE site.id = monster_images.site_id
        AND private.is_active_member(site.org_id)
    )
  );

-- Operational caches are service-role only.
DROP POLICY IF EXISTS "service_role_manage_gmail_message_processing" ON public.gmail_message_processing;
DROP POLICY IF EXISTS "service_role_manage_ocr_cache" ON public.ocr_cache;

CREATE POLICY "service_role_manage_gmail_message_processing"
  ON public.gmail_message_processing
  TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_manage_ocr_cache"
  ON public.ocr_cache
  TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
