-- ============================================================
-- Webhook OCR cache + message processing idempotency
-- ============================================================
-- 目的:
--   1) OCR結果をPDFハッシュ単位でキャッシュし、重複OCRを抑制する
--   2) Gmail message_id + history_id で処理履歴を保持し、Webhook重複配信を吸収する
--
-- 対象:
--   - public.ocr_cache
--   - public.gmail_message_processing
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ocr_cache (
  hash text PRIMARY KEY,
  extracted_text text NOT NULL,
  ocr_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_message_id text,
  source_attachment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 1 CHECK (hit_count >= 1)
);

CREATE INDEX IF NOT EXISTS ocr_cache_last_hit_idx
ON public.ocr_cache (last_hit_at DESC);

CREATE INDEX IF NOT EXISTS ocr_cache_source_message_idx
ON public.ocr_cache (source_message_id);

CREATE INDEX IF NOT EXISTS ocr_cache_source_attachment_idx
ON public.ocr_cache (source_attachment_id);

ALTER TABLE public.ocr_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_ocr_cache" ON public.ocr_cache;
CREATE POLICY "service_role_manage_ocr_cache"
ON public.ocr_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON TABLE public.ocr_cache IS 'PDFハッシュ単位のOCR結果キャッシュ';
COMMENT ON COLUMN public.ocr_cache.hash IS 'sha256(pdf binary)';
COMMENT ON COLUMN public.ocr_cache.ocr_result IS 'OcrResult JSON payload';

CREATE TABLE IF NOT EXISTS public.gmail_message_processing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL,
  history_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'processed', 'error')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, history_id)
);

CREATE INDEX IF NOT EXISTS gmail_message_processing_status_idx
ON public.gmail_message_processing (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS gmail_message_processing_message_idx
ON public.gmail_message_processing (message_id, created_at DESC);

ALTER TABLE public.gmail_message_processing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_gmail_message_processing" ON public.gmail_message_processing;
CREATE POLICY "service_role_manage_gmail_message_processing"
ON public.gmail_message_processing
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON TABLE public.gmail_message_processing IS 'Gmail Webhook処理履歴（message_id + history_id冪等キー）';
COMMENT ON COLUMN public.gmail_message_processing.status IS 'processing | processed | error';
