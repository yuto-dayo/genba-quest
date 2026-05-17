-- Office processing rules (事務処理規程) for the internal-control retention method.

CREATE TABLE IF NOT EXISTS public.office_processing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  version integer NOT NULL,
  title text NOT NULL DEFAULT '電子取引データの訂正及び削除の防止に関する事務処理規程',
  markdown_content text NOT NULL,
  pdf_storage_bucket text,
  pdf_storage_path text,
  pdf_original_filename text,
  pdf_mime_type text,
  pdf_file_size_bytes bigint,
  pdf_sha256 text,
  status text NOT NULL DEFAULT 'active',
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  registered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_processing_rules_version_check
    CHECK (version > 0),
  CONSTRAINT office_processing_rules_status_check
    CHECK (status = ANY (ARRAY['active', 'superseded', 'archived']::text[])),
  CONSTRAINT office_processing_rules_pdf_bucket_check
    CHECK (pdf_storage_bucket IS NULL OR pdf_storage_bucket = 'genba-electronic-documents'),
  CONSTRAINT office_processing_rules_pdf_mime_check
    CHECK (pdf_mime_type IS NULL OR pdf_mime_type = 'application/pdf'),
  CONSTRAINT office_processing_rules_pdf_file_size_check
    CHECK (pdf_file_size_bytes IS NULL OR (pdf_file_size_bytes > 0 AND pdf_file_size_bytes <= 52428800)),
  CONSTRAINT office_processing_rules_pdf_sha256_check
    CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS office_processing_rules_org_version_idx
  ON public.office_processing_rules (org_id, version);

CREATE UNIQUE INDEX IF NOT EXISTS office_processing_rules_pdf_storage_path_idx
  ON public.office_processing_rules (pdf_storage_bucket, pdf_storage_path)
  WHERE pdf_storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS office_processing_rules_org_created_idx
  ON public.office_processing_rules (org_id, created_at DESC);

DROP TRIGGER IF EXISTS office_processing_rules_set_updated_at ON public.office_processing_rules;
CREATE TRIGGER office_processing_rules_set_updated_at
  BEFORE UPDATE ON public.office_processing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.office_processing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read office_processing_rules" ON public.office_processing_rules;
CREATE POLICY "Read office_processing_rules"
  ON public.office_processing_rules
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP POLICY IF EXISTS "Write office_processing_rules as org admin" ON public.office_processing_rules;
CREATE POLICY "Write office_processing_rules as org admin"
  ON public.office_processing_rules
  FOR ALL
  TO authenticated
  USING (private.has_org_role(org_id, ARRAY['admin']::text[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['admin']::text[]));

GRANT SELECT ON TABLE public.office_processing_rules TO authenticated;
GRANT ALL ON TABLE public.office_processing_rules TO service_role;

COMMENT ON TABLE public.office_processing_rules IS
  '電子帳簿保存法の事務処理規程。MVPでは規程登録方式で訂正削除防止要件を満たす。';
