-- 031: Add soft delete columns to sites
-- Tracks who deleted, when, and why

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason text;

COMMENT ON COLUMN public.sites.deleted_at IS '論理削除日時';
COMMENT ON COLUMN public.sites.deleted_by IS '削除したユーザー';
COMMENT ON COLUMN public.sites.deletion_reason IS '削除理由';

CREATE INDEX IF NOT EXISTS sites_deleted_at_idx ON sites (deleted_at) WHERE deleted_at IS NOT NULL;
