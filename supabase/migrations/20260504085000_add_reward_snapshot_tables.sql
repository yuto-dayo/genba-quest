-- Forward rewrite of legacy server/sql/059_path_canonical_reward_writer_cutover.sql.
-- The legacy file is quarantined because it used user_metadata-based RLS. This
-- migration keeps the runtime-needed tables and uses org membership helpers.

CREATE TABLE IF NOT EXISTS public.reward_basis_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month_close_id uuid NOT NULL REFERENCES public.month_closes(id) ON DELETE CASCADE,
  period_ym text NOT NULL CHECK (period_ym ~ '^\d{4}-\d{2}$'),
  reward_rule_version_id uuid NOT NULL,
  policy_bundle_version_id uuid REFERENCES public.policy_bundle_versions(id) ON DELETE SET NULL,
  policy_fingerprint text NOT NULL,
  reward_engine_version text NOT NULL,
  rounding_mode text NOT NULL DEFAULT 'half_up',
  rounding_scale integer NOT NULL DEFAULT 0,
  rounding_minor_unit integer NOT NULL DEFAULT 1,
  recognized_revenue numeric(15, 2) NOT NULL DEFAULT 0,
  direct_costs numeric(15, 2) NOT NULL DEFAULT 0,
  overhead_allocated numeric(15, 2) NOT NULL DEFAULT 0,
  rule_reserve numeric(15, 2) NOT NULL DEFAULT 0,
  prior_period_adjustments numeric(15, 2) NOT NULL DEFAULT 0,
  closed_profit numeric(15, 2) NOT NULL DEFAULT 0,
  source_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month_close_id),
  CONSTRAINT reward_basis_snapshots_closed_profit_check
    CHECK (
      closed_profit = recognized_revenue
        - direct_costs
        - overhead_allocated
        - rule_reserve
        + prior_period_adjustments
    )
);

CREATE INDEX IF NOT EXISTS reward_basis_snapshots_org_close_idx
  ON public.reward_basis_snapshots (org_id, month_close_id, created_at DESC);

ALTER TABLE public.reward_basis_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_basis_snapshots" ON public.reward_basis_snapshots;
CREATE POLICY "Read reward_basis_snapshots"
  ON public.reward_basis_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS reward_basis_snapshots_set_updated_at ON public.reward_basis_snapshots;
CREATE TRIGGER reward_basis_snapshots_set_updated_at
  BEFORE UPDATE ON public.reward_basis_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.reward_basis_member_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  reward_basis_snapshot_id uuid NOT NULL REFERENCES public.reward_basis_snapshots(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  member_name text NOT NULL,
  role_level text NOT NULL CHECK (role_level IN ('L1', 'L2', 'L3', 'L4')),
  credited_units numeric(12, 2) NOT NULL DEFAULT 0,
  guaranteed_pay_amount numeric(15, 2) NOT NULL DEFAULT 0,
  guaranteed_pay_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  a_score integer NOT NULL DEFAULT 0,
  r_score integer NOT NULL DEFAULT 0,
  q_score integer NOT NULL DEFAULT 0,
  monthly_point_total integer NOT NULL DEFAULT 0,
  monthly_coefficient numeric(8, 4) NOT NULL DEFAULT 1,
  neutral_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reward_basis_snapshot_id, member_id)
);

CREATE INDEX IF NOT EXISTS reward_basis_member_snapshots_org_member_idx
  ON public.reward_basis_member_snapshots (org_id, member_id, created_at DESC);

ALTER TABLE public.reward_basis_member_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_basis_member_snapshots" ON public.reward_basis_member_snapshots;
CREATE POLICY "Read reward_basis_member_snapshots"
  ON public.reward_basis_member_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS reward_basis_member_snapshots_set_updated_at ON public.reward_basis_member_snapshots;
CREATE TRIGGER reward_basis_member_snapshots_set_updated_at
  BEFORE UPDATE ON public.reward_basis_member_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.reward_basis_package_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  reward_basis_snapshot_id uuid NOT NULL REFERENCES public.reward_basis_snapshots(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  work_package_id uuid REFERENCES public.path_work_packages(id) ON DELETE SET NULL,
  package_key text NOT NULL,
  month_close_line_id uuid REFERENCES public.month_close_lines(id) ON DELETE SET NULL,
  revenue_basis_id uuid REFERENCES public.revenue_basis(id) ON DELETE SET NULL,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  std_hours numeric(12, 2) NOT NULL DEFAULT 0,
  difficulty_band text NOT NULL CHECK (difficulty_band IN ('S1', 'S2', 'S3')),
  responsibility_share numeric(8, 4) NOT NULL DEFAULT 0,
  role_type text NOT NULL CHECK (role_type IN ('lead', 'support', 'teaching')),
  quality_result text NOT NULL CHECK (quality_result IN ('pass', 'minor_fix', 'major_fix')),
  rated_units numeric(12, 2) NOT NULL DEFAULT 0,
  source_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reward_basis_snapshot_id, member_id, package_key, role_type)
);

CREATE INDEX IF NOT EXISTS reward_basis_package_snapshots_org_snapshot_idx
  ON public.reward_basis_package_snapshots (org_id, reward_basis_snapshot_id, member_id);

ALTER TABLE public.reward_basis_package_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_basis_package_snapshots" ON public.reward_basis_package_snapshots;
CREATE POLICY "Read reward_basis_package_snapshots"
  ON public.reward_basis_package_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS reward_basis_package_snapshots_set_updated_at ON public.reward_basis_package_snapshots;
CREATE TRIGGER reward_basis_package_snapshots_set_updated_at
  BEFORE UPDATE ON public.reward_basis_package_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.reward_preview_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month_close_id uuid NOT NULL REFERENCES public.month_closes(id) ON DELETE CASCADE,
  reward_basis_snapshot_id uuid NOT NULL REFERENCES public.reward_basis_snapshots(id) ON DELETE CASCADE,
  reward_rule_version_id uuid NOT NULL,
  policy_bundle_version_id uuid REFERENCES public.policy_bundle_versions(id) ON DELETE SET NULL,
  policy_fingerprint text NOT NULL,
  reward_engine_version text NOT NULL,
  rounding_mode text NOT NULL DEFAULT 'half_up',
  rounding_scale integer NOT NULL DEFAULT 0,
  rounding_minor_unit integer NOT NULL DEFAULT 1,
  input_hash text NOT NULL,
  preview_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_profit numeric(15, 2) NOT NULL DEFAULT 0,
  path_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  base_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  variable_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  guaranteed_total_amount numeric(15, 2) NOT NULL DEFAULT 0,
  final_pay_total numeric(15, 2) NOT NULL DEFAULT 0,
  member_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month_close_id)
);

CREATE INDEX IF NOT EXISTS reward_preview_snapshots_org_close_idx
  ON public.reward_preview_snapshots (org_id, month_close_id, created_at DESC);

ALTER TABLE public.reward_preview_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_preview_snapshots" ON public.reward_preview_snapshots;
CREATE POLICY "Read reward_preview_snapshots"
  ON public.reward_preview_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP TRIGGER IF EXISTS reward_preview_snapshots_set_updated_at ON public.reward_preview_snapshots;
CREATE TRIGGER reward_preview_snapshots_set_updated_at
  BEFORE UPDATE ON public.reward_preview_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reward_runs_preview_snapshot_id_fkey'
      AND conrelid = 'public.reward_runs'::regclass
  ) THEN
    ALTER TABLE public.reward_runs
      ADD CONSTRAINT reward_runs_preview_snapshot_id_fkey
      FOREIGN KEY (preview_snapshot_id)
      REFERENCES public.reward_preview_snapshots(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.reward_run_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  reward_run_id uuid NOT NULL REFERENCES public.reward_runs(id) ON DELETE CASCADE,
  month_close_id uuid NOT NULL REFERENCES public.month_closes(id) ON DELETE RESTRICT,
  reward_rule_version_id uuid NOT NULL,
  policy_bundle_version_id uuid REFERENCES public.policy_bundle_versions(id) ON DELETE SET NULL,
  policy_fingerprint text NOT NULL,
  reward_engine_version text NOT NULL,
  rounding_mode text NOT NULL DEFAULT 'half_up',
  rounding_scale integer NOT NULL DEFAULT 0,
  rounding_minor_unit integer NOT NULL DEFAULT 1,
  closed_profit numeric(15, 2) NOT NULL DEFAULT 0,
  base_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  variable_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  member_count integer NOT NULL DEFAULT 0,
  final_pay_total numeric(15, 2) NOT NULL DEFAULT 0,
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipt_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reward_run_id)
);

CREATE INDEX IF NOT EXISTS reward_run_receipts_org_run_idx
  ON public.reward_run_receipts (org_id, reward_run_id, created_at DESC);

ALTER TABLE public.reward_run_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read reward_run_receipts" ON public.reward_run_receipts;
CREATE POLICY "Read reward_run_receipts"
  ON public.reward_run_receipts
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

GRANT SELECT ON TABLE
  public.reward_basis_snapshots,
  public.reward_basis_member_snapshots,
  public.reward_basis_package_snapshots,
  public.reward_preview_snapshots,
  public.reward_run_receipts
TO authenticated;

GRANT ALL ON TABLE
  public.reward_basis_snapshots,
  public.reward_basis_member_snapshots,
  public.reward_basis_package_snapshots,
  public.reward_preview_snapshots,
  public.reward_run_receipts
TO service_role;

COMMENT ON TABLE public.reward_basis_snapshots IS
  'Canonical reward-basis root fixed by month_close_id. Financial close inputs and reward-engine metadata are resolved here.';
COMMENT ON TABLE public.reward_basis_member_snapshots IS
  'Resolved member-level reward inputs fixed for a month_close_id, including credited units, level, guarantee basis, and A/R/Q outcomes.';
COMMENT ON TABLE public.reward_basis_package_snapshots IS
  'Resolved package-level contribution inputs fixed for reward replay. month_close_line_id / revenue_basis_id are stored when deterministically resolvable.';
COMMENT ON TABLE public.reward_preview_snapshots IS
  'Cached canonical reward preview keyed by fixed month_close_id. Recomputed only by internal repair paths.';
COMMENT ON TABLE public.reward_run_receipts IS
  'Audit receipt emitted when canonical reward run is fixed. Contains replay metadata and canonical/projection diff summary.';
