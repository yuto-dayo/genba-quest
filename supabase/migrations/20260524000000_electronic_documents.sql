-- Electronic bookkeeping document metadata for 電子帳簿保存法 searchability.
-- Files live in private Supabase Storage; this table is the immutable search/read model.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    VALUES (
      'genba-electronic-documents',
      'genba-electronic-documents',
      false,
      52428800,
      ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/tiff',
        'image/heic',
        'image/heif'
      ]::text[]
    )
    ON CONFLICT (id) DO UPDATE
    SET
      public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.electronic_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  kind text NOT NULL,
  transaction_date date NOT NULL,
  counterparty_name text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'genba-electronic-documents',
  storage_path text NOT NULL,
  original_filename text,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_transaction_id uuid REFERENCES public.accounting_transactions(id) ON DELETE SET NULL,
  registered_by uuid,
  registered_at timestamptz NOT NULL DEFAULT now(),
  retention_until date NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT electronic_documents_kind_check
    CHECK (kind = ANY (ARRAY['receipt', 'invoice', 'contract', 'purchase_order', 'delivery_note', 'other']::text[])),
  CONSTRAINT electronic_documents_amount_check
    CHECK (amount >= 0),
  CONSTRAINT electronic_documents_bucket_check
    CHECK (storage_bucket = 'genba-electronic-documents'),
  CONSTRAINT electronic_documents_file_size_check
    CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800),
  CONSTRAINT electronic_documents_mime_type_check
    CHECK (mime_type = 'application/pdf' OR mime_type LIKE 'image/%'),
  CONSTRAINT electronic_documents_sha256_check
    CHECK (sha256 ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS electronic_documents_storage_path_idx
  ON public.electronic_documents (storage_bucket, storage_path);

CREATE INDEX IF NOT EXISTS electronic_documents_org_transaction_search_idx
  ON public.electronic_documents (org_id, transaction_date, counterparty_name, amount);

CREATE INDEX IF NOT EXISTS electronic_documents_org_registered_idx
  ON public.electronic_documents (org_id, registered_at DESC);

CREATE OR REPLACE FUNCTION public.set_electronic_document_retention_until()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.retention_until := (NEW.transaction_date + INTERVAL '7 years')::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS electronic_documents_set_retention_until ON public.electronic_documents;
CREATE TRIGGER electronic_documents_set_retention_until
  BEFORE INSERT OR UPDATE OF transaction_date
  ON public.electronic_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_electronic_document_retention_until();

DROP TRIGGER IF EXISTS electronic_documents_set_updated_at ON public.electronic_documents;
CREATE TRIGGER electronic_documents_set_updated_at
  BEFORE UPDATE ON public.electronic_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.electronic_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read electronic_documents" ON public.electronic_documents;
CREATE POLICY "Read electronic_documents"
  ON public.electronic_documents
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Read org electronic document storage objects" ON storage.objects;
    CREATE POLICY "Read org electronic document storage objects"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'genba-electronic-documents'
        AND CASE
          WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN private.is_active_member(((storage.foldername(name))[1])::uuid)
          ELSE false
        END
      );
  END IF;
END;
$$;

GRANT SELECT ON TABLE public.electronic_documents TO authenticated;
GRANT ALL ON TABLE public.electronic_documents TO service_role;

COMMENT ON TABLE public.electronic_documents IS
  '電子帳簿保存法対応の電子取引保存メタデータ。検索要件(日付・取引先・金額)と7年保存期限を保持する。';
