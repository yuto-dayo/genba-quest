-- 039: Shared working-memory items for Today

CREATE TABLE IF NOT EXISTS public.focus_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('personal', 'org')),
  horizon text NOT NULL DEFAULT 'today' CHECK (horizon IN ('today', 'week', 'later')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  title text NOT NULL,
  note text,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  site_name_snapshot text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS focus_items_org_status_horizon_idx
  ON public.focus_items (org_id, status, horizon, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS focus_items_org_creator_status_idx
  ON public.focus_items (org_id, created_by, status, created_at DESC);

ALTER TABLE public.focus_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Focus Items" ON public.focus_items;
DROP POLICY IF EXISTS "Insert Focus Items" ON public.focus_items;
DROP POLICY IF EXISTS "Update Focus Items" ON public.focus_items;
DROP POLICY IF EXISTS "Delete Focus Items" ON public.focus_items;

CREATE POLICY "Read Focus Items" ON public.focus_items
  FOR SELECT TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "Insert Focus Items" ON public.focus_items
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
    AND created_by = auth.uid()
  );

CREATE POLICY "Update Focus Items" ON public.focus_items
  FOR UPDATE TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  )
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "Delete Focus Items" ON public.focus_items
  FOR DELETE TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
    AND (
      scope = 'org'
      OR created_by = auth.uid()
    )
  );
