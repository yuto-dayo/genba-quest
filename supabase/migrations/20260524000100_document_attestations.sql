-- Hash-chain attestations for electronic_documents.
-- The register RPC serializes each org chain with an advisory transaction lock.

CREATE TABLE IF NOT EXISTS public.document_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  electronic_document_id uuid NOT NULL REFERENCES public.electronic_documents(id) ON DELETE RESTRICT,
  attestation_sequence bigint NOT NULL,
  attested_sha256 text NOT NULL,
  previous_attestation_id uuid REFERENCES public.document_attestations(id) ON DELETE RESTRICT,
  previous_attestation_hash text,
  attestation_hash text NOT NULL,
  attested_by uuid,
  attested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_attestations_sequence_check
    CHECK (attestation_sequence > 0),
  CONSTRAINT document_attestations_sha256_check
    CHECK (attested_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT document_attestations_prev_hash_check
    CHECK (previous_attestation_hash IS NULL OR previous_attestation_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT document_attestations_hash_check
    CHECK (attestation_hash ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS document_attestations_org_sequence_idx
  ON public.document_attestations (org_id, attestation_sequence);

CREATE UNIQUE INDEX IF NOT EXISTS document_attestations_document_idx
  ON public.document_attestations (electronic_document_id);

CREATE INDEX IF NOT EXISTS document_attestations_org_created_idx
  ON public.document_attestations (org_id, attested_at, id);

ALTER TABLE public.document_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read document_attestations" ON public.document_attestations;
CREATE POLICY "Read document_attestations"
  ON public.document_attestations
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE OR REPLACE FUNCTION public.register_electronic_document(
  p_org_id uuid,
  p_kind text,
  p_transaction_date date,
  p_counterparty_name text,
  p_amount numeric,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_sha256 text,
  p_registered_by uuid,
  p_source_document_id uuid DEFAULT NULL,
  p_source_transaction_id uuid DEFAULT NULL,
  p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_document public.electronic_documents%ROWTYPE;
  v_previous public.document_attestations%ROWTYPE;
  v_attestation public.document_attestations%ROWTYPE;
  v_sequence bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text, 27000027));

  SELECT *
  INTO v_previous
  FROM public.document_attestations
  WHERE org_id = p_org_id
  ORDER BY attestation_sequence DESC
  LIMIT 1
  FOR UPDATE;

  v_sequence := COALESCE(v_previous.attestation_sequence, 0) + 1;

  INSERT INTO public.electronic_documents (
    org_id,
    kind,
    transaction_date,
    counterparty_name,
    amount,
    storage_path,
    original_filename,
    mime_type,
    file_size_bytes,
    sha256,
    source_document_id,
    source_transaction_id,
    registered_by,
    metadata_json,
    retention_until
  )
  VALUES (
    p_org_id,
    p_kind,
    p_transaction_date,
    NULLIF(BTRIM(p_counterparty_name), ''),
    p_amount,
    p_storage_path,
    p_original_filename,
    p_mime_type,
    p_file_size_bytes,
    p_sha256,
    p_source_document_id,
    p_source_transaction_id,
    p_registered_by,
    COALESCE(p_metadata_json, '{}'::jsonb),
    (p_transaction_date + INTERVAL '7 years')::date
  )
  RETURNING * INTO v_document;

  INSERT INTO public.document_attestations (
    org_id,
    electronic_document_id,
    attestation_sequence,
    attested_sha256,
    previous_attestation_id,
    previous_attestation_hash,
    attestation_hash,
    attested_by
  )
  VALUES (
    p_org_id,
    v_document.id,
    v_sequence,
    p_sha256,
    v_previous.id,
    v_previous.attestation_hash,
    encode(extensions.digest(
      concat_ws(
        '|',
        p_org_id::text,
        v_document.id::text,
        v_sequence::text,
        p_sha256,
        COALESCE(v_previous.id::text, ''),
        COALESCE(v_previous.attestation_hash, '')
      ),
      'sha256'
    ), 'hex'),
    p_registered_by
  )
  RETURNING * INTO v_attestation;

  RETURN jsonb_build_object(
    'document', to_jsonb(v_document),
    'attestation', to_jsonb(v_attestation)
  );
END;
$$;

GRANT SELECT ON TABLE public.document_attestations TO authenticated;
GRANT ALL ON TABLE public.document_attestations TO service_role;
GRANT EXECUTE ON FUNCTION public.register_electronic_document(
  uuid, text, date, text, numeric, text, text, text, bigint, text, uuid, uuid, uuid, jsonb
) TO service_role;

COMMENT ON TABLE public.document_attestations IS
  '電子帳簿保存法の改ざん検知用ハッシュチェーン。org単位で直列化され、各文書のSHA-256を連鎖保存する。';
