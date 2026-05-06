-- Private site drawing storage and immutable version metadata.
-- Client direct writes stay closed; the server service role owns uploads and version promotion.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'genba-drawings',
  'genba-drawings',
  false,
  104857600,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/tiff',
    'application/octet-stream',
    'application/acad',
    'application/x-acad',
    'application/dwg',
    'application/x-dwg',
    'application/vnd.dwg',
    'application/dxf',
    'application/x-dxf',
    'image/vnd.dwg',
    'image/vnd.dxf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.site_drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  title text NOT NULL,
  drawing_no text,
  discipline text,
  status text NOT NULL DEFAULT 'active',
  latest_version_no integer NOT NULL DEFAULT 0,
  current_version_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_drawings_status_check
    CHECK (status = ANY (ARRAY['active', 'archived', 'deleted']::text[])),
  CONSTRAINT site_drawings_latest_version_no_check
    CHECK (latest_version_no >= 0)
);

CREATE INDEX IF NOT EXISTS site_drawings_org_site_idx
  ON public.site_drawings (org_id, site_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS site_drawings_org_drawing_no_idx
  ON public.site_drawings (org_id, drawing_no)
  WHERE drawing_no IS NOT NULL;

ALTER TABLE public.site_drawings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_drawings" ON public.site_drawings;
CREATE POLICY "Read site_drawings"
  ON public.site_drawings
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS site_drawings_set_updated_at ON public.site_drawings;
CREATE TRIGGER site_drawings_set_updated_at
  BEFORE UPDATE ON public.site_drawings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.site_drawing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  drawing_id uuid NOT NULL REFERENCES public.site_drawings(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'genba-drawings',
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  sha256 text NOT NULL,
  uploaded_by uuid,
  change_note text,
  status text NOT NULL DEFAULT 'active',
  supersedes_version_id uuid REFERENCES public.site_drawing_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_drawing_versions_version_no_check
    CHECK (version_no > 0),
  CONSTRAINT site_drawing_versions_file_size_check
    CHECK (file_size > 0),
  CONSTRAINT site_drawing_versions_status_check
    CHECK (status = ANY (ARRAY['active', 'superseded', 'void']::text[])),
  CONSTRAINT site_drawing_versions_bucket_check
    CHECK (storage_bucket = 'genba-drawings')
);

CREATE UNIQUE INDEX IF NOT EXISTS site_drawing_versions_drawing_version_idx
  ON public.site_drawing_versions (drawing_id, version_no);

CREATE UNIQUE INDEX IF NOT EXISTS site_drawing_versions_storage_path_idx
  ON public.site_drawing_versions (storage_bucket, storage_path);

CREATE INDEX IF NOT EXISTS site_drawing_versions_org_site_idx
  ON public.site_drawing_versions (org_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS site_drawing_versions_drawing_created_idx
  ON public.site_drawing_versions (drawing_id, version_no DESC);

ALTER TABLE public.site_drawing_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_drawing_versions" ON public.site_drawing_versions;
CREATE POLICY "Read site_drawing_versions"
  ON public.site_drawing_versions
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'site_drawings_current_version_id_fkey'
      AND conrelid = 'public.site_drawings'::regclass
  ) THEN
    ALTER TABLE public.site_drawings
      ADD CONSTRAINT site_drawings_current_version_id_fkey
      FOREIGN KEY (current_version_id)
      REFERENCES public.site_drawing_versions(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Read org drawing storage objects" ON storage.objects;
CREATE POLICY "Read org drawing storage objects"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'genba-drawings'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN private.is_active_member(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  );

GRANT SELECT ON TABLE
  public.site_drawings,
  public.site_drawing_versions
TO authenticated;

GRANT ALL ON TABLE
  public.site_drawings,
  public.site_drawing_versions
TO service_role;

COMMENT ON TABLE public.site_drawings IS
  'Site-scoped drawing identity. Versions are immutable; this row points to the current promoted version.';

COMMENT ON TABLE public.site_drawing_versions IS
  'Immutable private Storage-backed drawing versions. Storage path starts with org_id for Storage RLS.';
