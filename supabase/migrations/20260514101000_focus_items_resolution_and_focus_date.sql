-- Today Todo V1: resolution classification + carryover date support

ALTER TABLE public.focus_items
  ADD COLUMN IF NOT EXISTS resolution_kind text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS focus_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'focus_items_resolution_kind_check'
  ) THEN
    ALTER TABLE public.focus_items
      ADD CONSTRAINT focus_items_resolution_kind_check
      CHECK (
        resolution_kind IS NULL
        OR resolution_kind IN (
          'completed_as_planned',
          'completed_with_change',
          'not_completed'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'focus_items_resolved_by_fkey'
  ) THEN
    ALTER TABLE public.focus_items
      ADD CONSTRAINT focus_items_resolved_by_fkey
      FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

UPDATE public.focus_items
SET focus_date = created_at::date
WHERE focus_date IS NULL;

CREATE INDEX IF NOT EXISTS focus_items_org_status_focus_date_created_idx
  ON public.focus_items (org_id, status, focus_date, created_at DESC);

CREATE INDEX IF NOT EXISTS focus_items_org_status_resolved_at_created_idx
  ON public.focus_items (org_id, status, resolved_at, created_at DESC);
