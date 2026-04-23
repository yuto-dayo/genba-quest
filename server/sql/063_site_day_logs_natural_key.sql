WITH ranked_day_logs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id, date, site_id, member_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_rank
  FROM public.site_day_logs
),
duplicate_day_logs AS (
  SELECT id
  FROM ranked_day_logs
  WHERE row_rank > 1
)
DELETE FROM public.site_day_logs AS logs
USING duplicate_day_logs
WHERE logs.id = duplicate_day_logs.id;

CREATE UNIQUE INDEX IF NOT EXISTS site_day_logs_org_date_site_member_uidx
  ON public.site_day_logs (org_id, date, site_id, member_id);
