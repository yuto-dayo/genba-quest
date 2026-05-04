-- 029: Add description and cautions columns to sites table
-- These fields support the simplified site management UX:
--   description: 作業内容 (what work is being done)
--   cautions: 注意事項 (safety warnings for workers)

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS cautions text;

COMMENT ON COLUMN public.sites.description IS '作業内容 - what work is being done at this site';
COMMENT ON COLUMN public.sites.cautions IS '注意事項 - safety warnings and cautions for workers';
