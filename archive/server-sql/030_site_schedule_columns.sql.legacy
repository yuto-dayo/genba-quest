-- 030: Add schedule columns to sites for project management
-- started_at: when work begins at this site
-- expected_completion_at: target completion date

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS started_at date,
  ADD COLUMN IF NOT EXISTS expected_completion_at date;

COMMENT ON COLUMN public.sites.started_at IS '工期開始日';
COMMENT ON COLUMN public.sites.expected_completion_at IS '完了予定日';
