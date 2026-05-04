-- ============================================================
-- PATH v2.2 Governed Vertical Slice
-- ============================================================
-- 目的:
--   1) proposal / event / policy 主導の PATH v2.2 用テーブルを追加
--   2) governance event / finance payout / evidence / projection を org 単位で分離
--   3) app 層から idempotent に同期しやすい unique key を持たせる
-- ============================================================

-- ============================================================
-- Governance Event Store
-- ============================================================

CREATE TABLE IF NOT EXISTS public.governance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS governance_events_org_created_idx
  ON public.governance_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS governance_events_org_type_idx
  ON public.governance_events (org_id, event_type, created_at DESC);

ALTER TABLE public.governance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read governance_events" ON public.governance_events;
CREATE POLICY "Read governance_events"
ON public.governance_events
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert governance_events" ON public.governance_events;
CREATE POLICY "Insert governance_events"
ON public.governance_events
FOR INSERT TO authenticated
WITH CHECK (true);

-- ============================================================
-- Policy Registry / Versioning
-- ============================================================

CREATE TABLE IF NOT EXISTS public.policy_bundle_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  bundle_key text NOT NULL,
  version text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'retired')),
  fingerprint text NOT NULL,
  policy_constants jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_approval_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bundle_key, version, revision),
  UNIQUE (org_id, published_proposal_id)
);

CREATE INDEX IF NOT EXISTS policy_bundle_versions_org_effective_idx
  ON public.policy_bundle_versions (org_id, bundle_key, effective_from DESC, revision DESC);

ALTER TABLE public.policy_bundle_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read policy_bundle_versions" ON public.policy_bundle_versions;
CREATE POLICY "Read policy_bundle_versions"
ON public.policy_bundle_versions
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert policy_bundle_versions" ON public.policy_bundle_versions;
CREATE POLICY "Insert policy_bundle_versions"
ON public.policy_bundle_versions
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update policy_bundle_versions" ON public.policy_bundle_versions;
CREATE POLICY "Update policy_bundle_versions"
ON public.policy_bundle_versions
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS policy_bundle_versions_set_updated_at ON public.policy_bundle_versions;
CREATE TRIGGER policy_bundle_versions_set_updated_at
BEFORE UPDATE ON public.policy_bundle_versions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- WorkOps / Management Accounting
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trade_families (
  key text PRIMARY KEY,
  label text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.trade_families (key, label, display_order)
VALUES
  ('wall_finish', '壁装', 10),
  ('floor_finish', '床仕上', 20),
  ('substrate_preparation', '下地補修', 30),
  ('decorative_sheet_or_film', 'シート / フィルム', 40),
  ('common_site_operations', '共通現場運用', 50)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    display_order = EXCLUDED.display_order,
    is_active = true;

CREATE TABLE IF NOT EXISTS public.path_site_item_profit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  item_name text NOT NULL,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  revenue numeric(15, 2) NOT NULL DEFAULT 0,
  material_cost numeric(15, 2) NOT NULL DEFAULT 0,
  subcontract_cost numeric(15, 2) NOT NULL DEFAULT 0,
  direct_cost numeric(15, 2) NOT NULL DEFAULT 0,
  gross_profit numeric(15, 2) NOT NULL DEFAULT 0,
  estimated_std_hours numeric(12, 2) NOT NULL DEFAULT 0,
  difficulty_band text NOT NULL DEFAULT 'S1'
    CHECK (difficulty_band IN ('S1', 'S2', 'S3')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, site_id, item_key)
);

CREATE INDEX IF NOT EXISTS path_site_item_profit_org_month_idx
  ON public.path_site_item_profit_snapshots (org_id, month, site_id);

ALTER TABLE public.path_site_item_profit_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_site_item_profit_snapshots" ON public.path_site_item_profit_snapshots;
CREATE POLICY "Read path_site_item_profit_snapshots"
ON public.path_site_item_profit_snapshots
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_site_item_profit_snapshots" ON public.path_site_item_profit_snapshots;
CREATE POLICY "Insert path_site_item_profit_snapshots"
ON public.path_site_item_profit_snapshots
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_site_item_profit_snapshots" ON public.path_site_item_profit_snapshots;
CREATE POLICY "Update path_site_item_profit_snapshots"
ON public.path_site_item_profit_snapshots
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS path_site_item_profit_snapshots_set_updated_at ON public.path_site_item_profit_snapshots;
CREATE TRIGGER path_site_item_profit_snapshots_set_updated_at
BEFORE UPDATE ON public.path_site_item_profit_snapshots
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.path_work_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  package_key text NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  site_item_profit_id uuid REFERENCES public.path_site_item_profit_snapshots(id) ON DELETE SET NULL,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  item_type text NOT NULL,
  quantity numeric(12, 2) NOT NULL DEFAULT 0,
  estimated_std_hours numeric(12, 2) NOT NULL DEFAULT 0,
  difficulty_band text NOT NULL DEFAULT 'S1'
    CHECK (difficulty_band IN ('S1', 'S2', 'S3')),
  risk_band text NOT NULL DEFAULT 'low'
    CHECK (risk_band IN ('low', 'medium', 'high')),
  protected_challenge_flag boolean NOT NULL DEFAULT false,
  quality_gate_type text NOT NULL DEFAULT 'standard',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, package_key)
);

CREATE INDEX IF NOT EXISTS path_work_packages_org_month_idx
  ON public.path_work_packages (org_id, month, site_id);

ALTER TABLE public.path_work_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_work_packages" ON public.path_work_packages;
CREATE POLICY "Read path_work_packages"
ON public.path_work_packages
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_work_packages" ON public.path_work_packages;
CREATE POLICY "Insert path_work_packages"
ON public.path_work_packages
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_work_packages" ON public.path_work_packages;
CREATE POLICY "Update path_work_packages"
ON public.path_work_packages
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS path_work_packages_set_updated_at ON public.path_work_packages;
CREATE TRIGGER path_work_packages_set_updated_at
BEFORE UPDATE ON public.path_work_packages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.path_work_package_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  work_package_id uuid NOT NULL REFERENCES public.path_work_packages(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  responsibility_share numeric(8, 4) NOT NULL DEFAULT 1,
  role_type text NOT NULL CHECK (role_type IN ('lead', 'support', 'teaching')),
  quality_result text NOT NULL CHECK (quality_result IN ('pass', 'minor_fix', 'major_fix')),
  rated_units numeric(12, 2) NOT NULL DEFAULT 0,
  points_override numeric(15, 4),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, work_package_id, member_id, role_type)
);

CREATE INDEX IF NOT EXISTS path_work_package_assignments_org_member_idx
  ON public.path_work_package_assignments (org_id, member_id, created_at DESC);

ALTER TABLE public.path_work_package_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_work_package_assignments" ON public.path_work_package_assignments;
CREATE POLICY "Read path_work_package_assignments"
ON public.path_work_package_assignments
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_work_package_assignments" ON public.path_work_package_assignments;
CREATE POLICY "Insert path_work_package_assignments"
ON public.path_work_package_assignments
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_work_package_assignments" ON public.path_work_package_assignments;
CREATE POLICY "Update path_work_package_assignments"
ON public.path_work_package_assignments
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS path_work_package_assignments_set_updated_at ON public.path_work_package_assignments;
CREATE TRIGGER path_work_package_assignments_set_updated_at
BEFORE UPDATE ON public.path_work_package_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Evidence / Monthly Input / AI Annotations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.path_monthly_close_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  role_level text CHECK (role_level IS NULL OR role_level IN ('L1', 'L2', 'L3', 'L4')),
  trade_family_observations jsonb NOT NULL DEFAULT '{}'::jsonb,
  aqr_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_site_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  comment text NOT NULL DEFAULT '',
  submitted_by jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, member_id)
);

CREATE INDEX IF NOT EXISTS path_monthly_close_inputs_org_month_idx
  ON public.path_monthly_close_inputs (org_id, month, submitted_at DESC);

ALTER TABLE public.path_monthly_close_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_monthly_close_inputs" ON public.path_monthly_close_inputs;
CREATE POLICY "Read path_monthly_close_inputs"
ON public.path_monthly_close_inputs
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_monthly_close_inputs" ON public.path_monthly_close_inputs;
CREATE POLICY "Insert path_monthly_close_inputs"
ON public.path_monthly_close_inputs
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_monthly_close_inputs" ON public.path_monthly_close_inputs;
CREATE POLICY "Update path_monthly_close_inputs"
ON public.path_monthly_close_inputs
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS path_monthly_close_inputs_set_updated_at ON public.path_monthly_close_inputs;
CREATE TRIGGER path_monthly_close_inputs_set_updated_at
BEFORE UPDATE ON public.path_monthly_close_inputs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.path_evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  trade_family text REFERENCES public.trade_families(key),
  evidence_class text NOT NULL
    CHECK (evidence_class IN (
      'human_confirmation',
      'performance_evidence',
      'quality_evidence',
      'record_evidence',
      'repeatability_evidence',
      'ai_annotation'
    )),
  origin_event_id text NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  summary text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS path_evidence_records_org_month_idx
  ON public.path_evidence_records (org_id, month, member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS path_evidence_records_origin_idx
  ON public.path_evidence_records (org_id, origin_event_id);

ALTER TABLE public.path_evidence_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_evidence_records" ON public.path_evidence_records;
CREATE POLICY "Read path_evidence_records"
ON public.path_evidence_records
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_evidence_records" ON public.path_evidence_records;
CREATE POLICY "Insert path_evidence_records"
ON public.path_evidence_records
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.path_ai_review_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  reviewer_kind text NOT NULL CHECK (reviewer_kind IN ('A', 'B')),
  adapter_key text NOT NULL,
  annotation jsonb NOT NULL DEFAULT '{}'::jsonb,
  supporting_evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  challenged_evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  model_version text NOT NULL DEFAULT 'deterministic-v1',
  prompt_version text NOT NULL DEFAULT 'deterministic-v1',
  schema_version text NOT NULL DEFAULT 'path-review-v1',
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, member_id, reviewer_kind)
);

CREATE INDEX IF NOT EXISTS path_ai_review_annotations_org_month_idx
  ON public.path_ai_review_annotations (org_id, month, member_id, reviewer_kind);

ALTER TABLE public.path_ai_review_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_ai_review_annotations" ON public.path_ai_review_annotations;
CREATE POLICY "Read path_ai_review_annotations"
ON public.path_ai_review_annotations
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_ai_review_annotations" ON public.path_ai_review_annotations;
CREATE POLICY "Insert path_ai_review_annotations"
ON public.path_ai_review_annotations
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_ai_review_annotations" ON public.path_ai_review_annotations;
CREATE POLICY "Update path_ai_review_annotations"
ON public.path_ai_review_annotations
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS path_ai_review_annotations_set_updated_at ON public.path_ai_review_annotations;
CREATE TRIGGER path_ai_review_annotations_set_updated_at
BEFORE UPDATE ON public.path_ai_review_annotations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- PATH Close / Reward / Profile Projections
-- ============================================================

CREATE TABLE IF NOT EXISTS public.path_month_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  month text NOT NULL,
  member_id uuid NOT NULL,
  policy_bundle_version_id uuid REFERENCES public.policy_bundle_versions(id) ON DELETE SET NULL,
  policy_fingerprint text NOT NULL,
  input_hash text NOT NULL,
  current_role_level text CHECK (current_role_level IS NULL OR current_role_level IN ('L1', 'L2', 'L3', 'L4')),
  A integer NOT NULL CHECK (A BETWEEN 0 AND 2),
  R integer NOT NULL CHECK (R BETWEEN 0 AND 2),
  Q integer NOT NULL CHECK (Q BETWEEN 0 AND 2),
  neutral_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  close_status text NOT NULL DEFAULT 'closed'
    CHECK (close_status IN ('draft', 'review_required', 'closed')),
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  finalized_by jsonb,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_id),
  UNIQUE (org_id, month, member_id)
);

CREATE INDEX IF NOT EXISTS path_month_closes_org_month_idx
  ON public.path_month_closes (org_id, month, finalized_at DESC);

ALTER TABLE public.path_month_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_month_closes" ON public.path_month_closes;
CREATE POLICY "Read path_month_closes"
ON public.path_month_closes
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_month_closes" ON public.path_month_closes;
CREATE POLICY "Insert path_month_closes"
ON public.path_month_closes
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.path_credited_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  close_id uuid NOT NULL REFERENCES public.path_month_closes(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  unit_type text NOT NULL,
  units numeric(12, 2) NOT NULL DEFAULT 0,
  source_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, close_id, member_id, unit_type, source_id)
);

CREATE INDEX IF NOT EXISTS path_credited_units_org_member_idx
  ON public.path_credited_units (org_id, member_id, created_at DESC);

ALTER TABLE public.path_credited_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_credited_units" ON public.path_credited_units;
CREATE POLICY "Read path_credited_units"
ON public.path_credited_units
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_credited_units" ON public.path_credited_units;
CREATE POLICY "Insert path_credited_units"
ON public.path_credited_units
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.path_trade_endorsements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  member_id uuid NOT NULL,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  skill_status text NOT NULL
    CHECK (skill_status IN (
      'unverified',
      'assist_required',
      'conditional',
      'near_independent',
      'stable_independent'
    )),
  confidence_class text NOT NULL CHECK (confidence_class IN ('low', 'medium', 'high')),
  freshness_status text NOT NULL CHECK (freshness_status IN ('current', 'stale_review_required')),
  evidence_class_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_event_ids text[] NOT NULL DEFAULT '{}'::text[],
  source_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  approved_by jsonb,
  approved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, member_id, trade_family)
);

CREATE INDEX IF NOT EXISTS path_trade_endorsements_org_member_idx
  ON public.path_trade_endorsements (org_id, member_id, approved_at DESC);

ALTER TABLE public.path_trade_endorsements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_trade_endorsements" ON public.path_trade_endorsements;
CREATE POLICY "Read path_trade_endorsements"
ON public.path_trade_endorsements
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_trade_endorsements" ON public.path_trade_endorsements;
CREATE POLICY "Insert path_trade_endorsements"
ON public.path_trade_endorsements
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_trade_endorsements" ON public.path_trade_endorsements;
CREATE POLICY "Update path_trade_endorsements"
ON public.path_trade_endorsements
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS path_trade_endorsements_set_updated_at ON public.path_trade_endorsements;
CREATE TRIGGER path_trade_endorsements_set_updated_at
BEFORE UPDATE ON public.path_trade_endorsements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.path_assignment_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  member_id uuid NOT NULL,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  restriction_level text NOT NULL CHECK (restriction_level IN ('none', 'observe_only', 'support_required', 'blocked')),
  reason_code text NOT NULL,
  detail text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  source_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS path_assignment_restrictions_org_member_idx
  ON public.path_assignment_restrictions (org_id, member_id, started_at DESC);

ALTER TABLE public.path_assignment_restrictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_assignment_restrictions" ON public.path_assignment_restrictions;
CREATE POLICY "Read path_assignment_restrictions"
ON public.path_assignment_restrictions
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_assignment_restrictions" ON public.path_assignment_restrictions;
CREATE POLICY "Insert path_assignment_restrictions"
ON public.path_assignment_restrictions
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.path_opportunity_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  month text NOT NULL,
  member_id uuid NOT NULL,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  opportunity_status text NOT NULL
    CHECK (opportunity_status IN ('not_observed', 'opportunity_not_granted', 'recheck_required', 'observed')),
  eligible_but_unassigned_days numeric(12, 2) NOT NULL DEFAULT 0,
  opportunity_concentration_score numeric(12, 4) NOT NULL DEFAULT 0,
  promotion_blocked_by_opportunity boolean NOT NULL DEFAULT false,
  protected_challenge_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, member_id, trade_family)
);

CREATE INDEX IF NOT EXISTS path_opportunity_audits_org_month_idx
  ON public.path_opportunity_audits (org_id, month, member_id);

ALTER TABLE public.path_opportunity_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_opportunity_audits" ON public.path_opportunity_audits;
CREATE POLICY "Read path_opportunity_audits"
ON public.path_opportunity_audits
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_opportunity_audits" ON public.path_opportunity_audits;
CREATE POLICY "Insert path_opportunity_audits"
ON public.path_opportunity_audits
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_opportunity_audits" ON public.path_opportunity_audits;
CREATE POLICY "Update path_opportunity_audits"
ON public.path_opportunity_audits
FOR UPDATE TO authenticated
USING (true);

DROP TRIGGER IF EXISTS path_opportunity_audits_set_updated_at ON public.path_opportunity_audits;
CREATE TRIGGER path_opportunity_audits_set_updated_at
BEFORE UPDATE ON public.path_opportunity_audits
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.path_reward_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  month text NOT NULL,
  close_id uuid REFERENCES public.path_month_closes(id) ON DELETE SET NULL,
  policy_bundle_version_id uuid REFERENCES public.policy_bundle_versions(id) ON DELETE SET NULL,
  policy_fingerprint text NOT NULL,
  input_hash text NOT NULL,
  run_type text NOT NULL DEFAULT 'standard'
    CHECK (run_type IN ('standard', 'reversal', 'adjustment')),
  correction_of_reward_run_id uuid REFERENCES public.path_reward_runs(id) ON DELETE SET NULL,
  target_month text,
  closed_profit numeric(15, 2) NOT NULL DEFAULT 0,
  path_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  base_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  variable_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  guarantee_total_amount numeric(15, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'posted', 'reversed')),
  reward_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by jsonb,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS path_reward_runs_org_month_idx
  ON public.path_reward_runs (org_id, month, approved_at DESC);

ALTER TABLE public.path_reward_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_reward_runs" ON public.path_reward_runs;
CREATE POLICY "Read path_reward_runs"
ON public.path_reward_runs
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_reward_runs" ON public.path_reward_runs;
CREATE POLICY "Insert path_reward_runs"
ON public.path_reward_runs
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update path_reward_runs" ON public.path_reward_runs;
CREATE POLICY "Update path_reward_runs"
ON public.path_reward_runs
FOR UPDATE TO authenticated
USING (true);

CREATE TABLE IF NOT EXISTS public.path_explanation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  reward_run_id uuid NOT NULL REFERENCES public.path_reward_runs(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  month text NOT NULL,
  member_id uuid NOT NULL,
  explanation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_id, member_id)
);

CREATE INDEX IF NOT EXISTS path_explanation_snapshots_org_month_idx
  ON public.path_explanation_snapshots (org_id, month, rendered_at DESC);

ALTER TABLE public.path_explanation_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_explanation_snapshots" ON public.path_explanation_snapshots;
CREATE POLICY "Read path_explanation_snapshots"
ON public.path_explanation_snapshots
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert path_explanation_snapshots" ON public.path_explanation_snapshots;
CREATE POLICY "Insert path_explanation_snapshots"
ON public.path_explanation_snapshots
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.finance_payout_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  reward_run_id uuid NOT NULL REFERENCES public.path_reward_runs(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  posting_kind text NOT NULL CHECK (posting_kind IN ('payout', 'reversal', 'adjustment')),
  accounting_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  amount numeric(15, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'JPY',
  target_month text NOT NULL,
  correction_month text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_id, member_id, posting_kind)
);

CREATE INDEX IF NOT EXISTS finance_payout_postings_org_month_idx
  ON public.finance_payout_postings (org_id, target_month, posted_at DESC);

ALTER TABLE public.finance_payout_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read finance_payout_postings" ON public.finance_payout_postings;
CREATE POLICY "Read finance_payout_postings"
ON public.finance_payout_postings
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Insert finance_payout_postings" ON public.finance_payout_postings;
CREATE POLICY "Insert finance_payout_postings"
ON public.finance_payout_postings
FOR INSERT TO authenticated
WITH CHECK (true);
