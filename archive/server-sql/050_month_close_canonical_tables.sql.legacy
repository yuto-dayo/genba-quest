-- ============================================================
-- 050: Month close canonical tables
-- ============================================================
-- 目的:
--   1) reward input の immutable snapshot root を canonical 化する
--   2) revenue_basis を period root (month_close_id) に固定する
--   3) fan-in lineage を month_close_line_sources で正規化する
-- メモ:
--   - 既存 path_month_closes / path_credited_units は互換期間の read model として残す
--   - month_close summary view/materialized view は後続 migration で追加する
-- ============================================================

CREATE TABLE IF NOT EXISTS public.month_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  period_ym text NOT NULL CHECK (period_ym ~ '^\d{4}-\d{2}$'),
  status text NOT NULL CHECK (status IN ('draft', 'fixed', 'superseded')),
  source_cutoff_at timestamptz NOT NULL,
  fixed_at timestamptz,
  fixed_by jsonb,
  supersedes_month_close_id uuid REFERENCES public.month_closes(id) ON DELETE RESTRICT,
  close_rule_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT month_closes_fixed_fields_check
    CHECK (
      (status = 'fixed' AND fixed_at IS NOT NULL)
      OR (status IN ('draft', 'superseded'))
    )
);

CREATE INDEX IF NOT EXISTS month_closes_org_period_created_idx
  ON public.month_closes (org_id, period_ym, created_at DESC);

CREATE INDEX IF NOT EXISTS month_closes_supersedes_idx
  ON public.month_closes (supersedes_month_close_id)
  WHERE supersedes_month_close_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS month_closes_fixed_once_per_period
  ON public.month_closes (org_id, period_ym)
  WHERE status = 'fixed';

ALTER TABLE public.month_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read month_closes" ON public.month_closes;
DROP POLICY IF EXISTS "Insert month_closes" ON public.month_closes;
DROP POLICY IF EXISTS "Update month_closes" ON public.month_closes;

CREATE POLICY "Read month_closes"
ON public.month_closes
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert month_closes"
ON public.month_closes
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update month_closes"
ON public.month_closes
FOR UPDATE TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
)
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE TABLE IF NOT EXISTS public.month_close_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month_close_id uuid NOT NULL REFERENCES public.month_closes(id) ON DELETE CASCADE,
  revenue_basis_id uuid NOT NULL REFERENCES public.revenue_basis(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  recognized_at timestamptz NOT NULL,
  sales_amount numeric(15, 2) NOT NULL DEFAULT 0,
  cost_amount numeric(15, 2) NOT NULL DEFAULT 0,
  profit_amount numeric(15, 2) NOT NULL DEFAULT 0,
  dimensions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  dimension_hash text NOT NULL,
  source_income_posting_group_id uuid NOT NULL REFERENCES public.posting_groups(id) ON DELETE RESTRICT,
  source_site_completion_event_id uuid NOT NULL REFERENCES public.site_completion_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT month_close_lines_profit_balance_check
    CHECK (profit_amount = sales_amount - cost_amount),
  UNIQUE (month_close_id, revenue_basis_id, dimension_hash)
);

CREATE INDEX IF NOT EXISTS month_close_lines_close_idx
  ON public.month_close_lines (month_close_id, created_at DESC);

CREATE INDEX IF NOT EXISTS month_close_lines_revenue_basis_idx
  ON public.month_close_lines (revenue_basis_id);

CREATE INDEX IF NOT EXISTS month_close_lines_site_idx
  ON public.month_close_lines (site_id, recognized_at DESC);

CREATE INDEX IF NOT EXISTS month_close_lines_source_posting_group_idx
  ON public.month_close_lines (source_income_posting_group_id);

ALTER TABLE public.month_close_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read month_close_lines" ON public.month_close_lines;
DROP POLICY IF EXISTS "Insert month_close_lines" ON public.month_close_lines;
DROP POLICY IF EXISTS "Update month_close_lines" ON public.month_close_lines;

CREATE POLICY "Read month_close_lines"
ON public.month_close_lines
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert month_close_lines"
ON public.month_close_lines
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update month_close_lines"
ON public.month_close_lines
FOR UPDATE TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
)
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE TABLE IF NOT EXISTS public.month_close_line_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month_close_line_id uuid NOT NULL REFERENCES public.month_close_lines(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN (
    'posting_group',
    'proposal_execution',
    'site_completion_event',
    'revenue_basis'
  )),
  source_id uuid NOT NULL,
  contribution_sales numeric(15, 2) NOT NULL DEFAULT 0,
  contribution_cost numeric(15, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month_close_line_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS month_close_line_sources_line_idx
  ON public.month_close_line_sources (month_close_line_id, created_at DESC);

CREATE INDEX IF NOT EXISTS month_close_line_sources_source_idx
  ON public.month_close_line_sources (source_type, source_id);

ALTER TABLE public.month_close_line_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read month_close_line_sources" ON public.month_close_line_sources;
DROP POLICY IF EXISTS "Insert month_close_line_sources" ON public.month_close_line_sources;
DROP POLICY IF EXISTS "Update month_close_line_sources" ON public.month_close_line_sources;

CREATE POLICY "Read month_close_line_sources"
ON public.month_close_line_sources
FOR SELECT TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Insert month_close_line_sources"
ON public.month_close_line_sources
FOR INSERT TO authenticated
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

CREATE POLICY "Update month_close_line_sources"
ON public.month_close_line_sources
FOR UPDATE TO authenticated
USING (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
)
WITH CHECK (
  org_id = COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
);

COMMENT ON TABLE public.month_closes IS
  'Canonical period root for immutable reward input snapshots. period_ym is display/search only; identity is month_close_id.';

COMMENT ON TABLE public.month_close_lines IS
  'Canonical reward input lines keyed by month_close_id + revenue_basis_id + dimension_hash.';

COMMENT ON TABLE public.month_close_line_sources IS
  'Normalized fan-in lineage for month_close_lines. Source ids must not be stored only as JSON arrays.';
