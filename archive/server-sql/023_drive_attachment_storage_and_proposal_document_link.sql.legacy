-- ============================================================
-- Gmail attachment storage on Google Drive + proposal/document linkage
-- ============================================================
-- Goal:
--   1) Store Gmail attachments on Drive as the primary source of truth
--   2) Keep backward compatibility with existing manual uploads (storage_path)
--   3) Link proposals to source documents and sites
-- ============================================================

ALTER TABLE public.documents
  ALTER COLUMN storage_path DROP NOT NULL,
  ALTER COLUMN uploaded_by DROP NOT NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS gmail_attachment_id text,
  ADD COLUMN IF NOT EXISTS drive_file_id text,
  ADD COLUMN IF NOT EXISTS drive_file_url text,
  ADD COLUMN IF NOT EXISTS drive_folder_id text,
  ADD COLUMN IF NOT EXISTS ocr_text text;

CREATE UNIQUE INDEX IF NOT EXISTS documents_gmail_attachment_unique_idx
ON public.documents (gmail_message_id, gmail_attachment_id)
WHERE gmail_message_id IS NOT NULL AND gmail_attachment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS documents_drive_file_id_idx
ON public.documents (drive_file_id);

CREATE INDEX IF NOT EXISTS documents_drive_folder_id_idx
ON public.documents (drive_folder_id);

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS proposals_document_id_idx
ON public.proposals (document_id);

CREATE INDEX IF NOT EXISTS proposals_site_id_idx
ON public.proposals (site_id);

COMMENT ON COLUMN public.documents.gmail_message_id IS 'Gmail message id that carried the attachment';
COMMENT ON COLUMN public.documents.gmail_attachment_id IS 'Gmail attachment id';
COMMENT ON COLUMN public.documents.drive_file_id IS 'Google Drive file id';
COMMENT ON COLUMN public.documents.drive_file_url IS 'Google Drive preview URL';
COMMENT ON COLUMN public.documents.drive_folder_id IS 'Google Drive parent folder id';
COMMENT ON COLUMN public.documents.ocr_text IS 'Cached extracted text for classification/reprocessing';
COMMENT ON COLUMN public.proposals.document_id IS 'Source document reference';
COMMENT ON COLUMN public.proposals.site_id IS 'Proposal-level site scope for filtering';
