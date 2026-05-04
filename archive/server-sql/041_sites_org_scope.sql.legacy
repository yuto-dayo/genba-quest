-- 041: Scope sites by org and tighten RLS

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE public.sites AS s
SET org_id = c.org_id
FROM public.clients AS c
WHERE s.client_id = c.id
  AND s.org_id IS NULL
  AND c.org_id IS NOT NULL;

UPDATE public.sites
SET org_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE org_id IS NULL;

ALTER TABLE public.sites
  ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS sites_org_id_idx
  ON public.sites (org_id);

CREATE INDEX IF NOT EXISTS sites_org_id_status_idx
  ON public.sites (org_id, status, created_at DESC);

DROP POLICY IF EXISTS "Read Sites" ON public.sites;
DROP POLICY IF EXISTS "Insert Sites" ON public.sites;
DROP POLICY IF EXISTS "Update Sites" ON public.sites;

CREATE POLICY "Read Sites" ON public.sites
  FOR SELECT TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Insert Sites" ON public.sites
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Update Sites" ON public.sites
  FOR UPDATE TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  )
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );
