-- 034: Scope clients by org and support secure filtering

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL
    DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;

UPDATE public.clients
SET org_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS clients_org_id_idx ON public.clients (org_id);
CREATE INDEX IF NOT EXISTS clients_org_id_deleted_at_idx
  ON public.clients (org_id, deleted_at);

DROP POLICY IF EXISTS "Read Clients" ON public.clients;

CREATE POLICY "Read Clients" ON public.clients
  FOR SELECT TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );
